"""D-Flow FM model builder — rectilinear net.nc + mdu + dimr for our DEM grid.

Ported from damatlas pipeline/simulation/model_builder.py (loguru stripped),
adapted to the Niyanta solver contract:

  * geometry comes from the run's conditioned grid (grid_meta geo + z),
    row-flipped south→north so D-Flow's clockwise element convention holds;
  * the dam is an ensured ridge across the full valley at the dam row band
    (synthetic DEMs have no physical wall) with the solved breach gap carved
    to the BreachGeom bottom elevation;
    * the reservoir starts at initial_level_m via an ASCII IniFieldFile
    (fileVersion 2.02) polygon constant for initialWaterLevel covering the
    reservoir up to the dam crest row (gap cells inside the polygon start
    primed at reservoir level). Cells outside keep sini=0 and are clamped
    dry by the engine's s1=max(bl,s1) finalisation, so the open breach gap
    cannot leak level across the ridge the way a WaterLevIniFile flood-fill
    does (flood-fill spreads while level >= link bottom, and the gap bottom
    is below the level). The polygon deliberately stops at the crest row:
    the engine derives element bed level as the min of its corner nodes, so
    the band's downstream face smears below reservoir level and an
    included face row would start as an artificial free sheet that
    collapses downstream at t=0.

NetLink/NetElemNode indices are written 1-based (Fortran convention, as in
Deltares example nets); a 0-based file makes the engine shift every
element by one node and orphan the last node/link/element.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

_MDU = """# Niyanta-created D-Flow FM master definition (community edition)
[General]
Program                           = D-Flow FM
AutoStart                         = 0
FileVersion                       = 1.02

[geometry]
NetFile                           = {name}_net.nc
IniFieldFile                      = {ini_field}
BedlevType                        = 3
Kmx                               = 0
AngLat                            = {ang_lat:.1f}

[numerics]
CFLMax                            = 0.7
AdvecType                         = 33
Icgsolver                         = 4
Turbulencemodel                   = 3
Epshu                             = 0.0001

[physics]
UnifFrictCoef                     = 45
UnifFrictType                     = 0
Ag                                = 9.813
Vicouv                            = 2
Dicouv                            = 10

[wind]
ICdtyp                            = 2
Cdbreakpoints                     = 0.0025 0.0025
Windspeedbreakpoints              = 0 100
Rhoair                            = 1

[time]
RefDate                           = 20260101
Tunit                             = M
DtUser                            = 30
DtMax                             = 30
DtInit                            = 1
AutoTimestep                      = 1
StartDateTime                     = 20260101000000
StopDateTime                       = {stop}
Tzone                             = 0

[output]
OutputDir                         = output
HisInterval                       = {his_interval:.1f}
MapInterval                       = {map_interval:.1f}
MapFormat                         = 1
Wrimap_waterlevel_s0              = 1
Wrimap_waterlevel_s1              = 1
Wrimap_velocity_component_u1      = 1
Wrimap_flow_flux_q1               = 1
Wrihis_waterlevel_s1              = 1
Wrihis_velocity_vector            = 1
Wrihis_balance                    = 1

[waves]
Wavemodelnr                       = 0
"""

_DIMR = """<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<dimrConfig xmlns="http://schemas.deltares.nl/dimr" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://schemas.deltares.nl/dimr https://content.oss.deltares.nl/schemas/dimr-1.2.xsd">
  <documentation>
    <fileVersion>1.2</fileVersion>
    <createdBy>Niyanta, D-Flow FM integration</createdBy>
  </documentation>
  <control>
    <start name="DFlowFM" />
  </control>
  <component name="DFlowFM">
    <library>dflowfm</library>
    <process>0</process>
    <mpiCommunicator>DFM_COMM_DFMWORLD</mpiCommunicator>
    <workingDir>.</workingDir>
    <inputFile>{name}.mdu</inputFile>
  </component>
</dimrConfig>
"""


def write_net_nc(path: Path, x: np.ndarray, y: np.ndarray, z: np.ndarray) -> None:
    """Rectilinear quad mesh as D-Flow FM *_net.nc (south→north row order)."""
    import netCDF4

    ny, nx = z.shape[0] - 1, z.shape[1] - 1
    n_node = (nx + 1) * (ny + 1)
    n_elem = nx * ny
    node_idx = np.arange(n_node).reshape((ny + 1, nx + 1))

    elem_nodes = np.empty((n_elem, 4), dtype=np.int32)
    e = 0
    for r in range(ny):
        for c in range(nx):
            bl, br = node_idx[r, c], node_idx[r, c + 1]
            tl, tr = node_idx[r + 1, c], node_idx[r + 1, c + 1]
            elem_nodes[e] = (bl, tl, tr, br)
            e += 1
    # D-Flow FM reads net indices as 1-based (Fortran convention)
    elem_nodes += 1

    links: list[tuple[int, int]] = []
    for r in range(ny + 1):
        for c in range(nx):
            links.append((int(node_idx[r, c]), int(node_idx[r, c + 1])))
    for r in range(ny):
        for c in range(nx + 1):
            links.append((int(node_idx[r, c]), int(node_idx[r + 1, c])))
    link_arr = np.array(links, dtype=np.int32) + 1

    lon = np.asarray(x, dtype=np.float64).ravel()
    lat = np.asarray(y, dtype=np.float64).ravel()
    zz = np.asarray(z, dtype=np.float64).ravel()

    ds = netCDF4.Dataset(str(path), "w", format="NETCDF4")
    ds.setncattr("institution", "Niyanta")
    ds.setncattr("source", "Niyanta D-Flow FM builder")
    ds.setncattr("Conventions", "CF-1.5:Deltares-0.1")
    ds.createDimension("nNetNode", n_node)
    ds.createDimension("nNetLink", len(links))
    ds.createDimension("nNetLinkPts", 2)
    ds.createDimension("nNetElem", n_elem)
    ds.createDimension("nNetElemMaxNode", 4)
    ds.createDimension("nBndLink", 0)

    v = ds.createVariable("wgs84", "i4")
    v.setncattr("name", "WGS84")
    v.setncattr("epsg", 4326)
    v.setncattr("grid_mapping_name", "latitude_longitude")
    v.setncattr("longitude_of_prime_meridian", 0.0)
    v.setncattr("semi_major_axis", 6378137.0)
    v.setncattr("semi_minor_axis", 6356752.314245)
    v.setncattr("inverse_flattening", 298.257223563)
    v.setncattr("proj4_params", "")
    v.setncattr("EPSG_code", "EPSG:4326")
    v.setncattr("projection_name", "")
    v.setncattr("wkt", "")
    v.setncattr("comment", "")
    v[:] = 1

    node_attrs = {
        "NetNode_x": {"units": "degrees_east", "standard_name": "longitude",
                      "long_name": "x-coordinate of net nodes", "grid_mapping": "wgs84"},
        "NetNode_y": {"units": "degrees_north", "standard_name": "latitude",
                      "long_name": "y-coordinate of net nodes", "grid_mapping": "wgs84"},
        "NetNode_lon": {"units": "degrees_east", "standard_name": "longitude",
                        "long_name": "longitude", "grid_mapping": "wgs84"},
        "NetNode_lat": {"units": "degrees_north", "standard_name": "latitude",
                        "long_name": "latitude", "grid_mapping": "wgs84"},
        "NetNode_z": {"units": "m", "positive": "up",
                      "long_name": "Bottom level at net nodes (flow element's corners)",
                      "grid_mapping": "wgs84"},
    }
    for name, data in (("NetNode_x", lon), ("NetNode_y", lat),
                       ("NetNode_lon", lon), ("NetNode_lat", lat)):
        vv = ds.createVariable(name, "f8", ("nNetNode",))
        for k, val in node_attrs[name].items():
            vv.setncattr(k, val)
        vv[:] = data
    vv = ds.createVariable("NetNode_z", "f8", ("nNetNode",))
    for k, val in node_attrs["NetNode_z"].items():
        vv.setncattr(k, val)
    vv[:] = zz

    ds.createVariable("NetLink", "i4", ("nNetLink", "nNetLinkPts"))[:] = link_arr
    ds.createVariable("NetLinkType", "i4", ("nNetLink",))[:] = np.full(len(links), 2, dtype=np.int32)
    ds.createVariable("NetElemNode", "i4", ("nNetElem", "nNetElemMaxNode"))[:] = elem_nodes
    ds.createVariable("BndLink", "i4", ("nBndLink",))[:] = np.zeros(0, dtype=np.int32)
    ds.close()


def build_model(
    model_dir: Path,
    *,
    z: np.ndarray,
    geo: dict[str, Any],
    dam_rc: tuple[int, int],
    breach_cells: tuple[np.ndarray, np.ndarray],
    initial_level_m: float,
    dam_height_m: float,
    breach_depth_m: float,
    duration_s: float,
    frames: int,
    model_name: str = "niyanta",
) -> dict[str, Any]:
    """Create the full D-Flow FM input set under model_dir; returns manifest."""
    model_dir.mkdir(parents=True, exist_ok=True)
    h, w = z.shape
    dx, dy = geo["dx_deg"], geo["dy_deg"]
    origin_lon, origin_lat = geo["origin_lon"], geo["origin_lat"]
    lat_min = origin_lat - h * dy

    # south→north flip so D-Flow's clockwise element ordering holds
    zf = np.flipud(z).astype(np.float64)

    # ensure a full-width dam ridge at the dam row band (real DEMs already
    # have one; synthetic valleys do not)
    band = [h - 1 - int(dam_rc[0]) + dr for dr in (-1, 0, 1)]
    band = [r for r in band if 0 <= r < h]
    crest = max(initial_level_m + 0.1 * dam_height_m, float(zf[band].max()))
    for r in band:
        zf[r, :] = np.maximum(zf[r, :], crest)

    # carve the solved breach gap through the ridge
    b_r = np.asarray(breach_cells[0], dtype=np.int64)
    b_c = np.asarray(breach_cells[1], dtype=np.int64)
    cols = np.arange(int(b_c.min()), int(b_c.max()) + 1)
    gap_bottom = float(np.clip(crest - float(breach_depth_m),
                               float(zf.min()), initial_level_m - 1.0))
    for r in band:
        zf[r, cols] = gap_bottom

    # nodes: mean of the up-to-4 adjacent cells (edge-padded)
    zp = np.pad(zf, 1, mode="edge")
    node_z = (zp[:-1, :-1] + zp[:-1, 1:] + zp[1:, :-1] + zp[1:, 1:]) / 4.0

    lon = origin_lon + np.arange(w + 1) * dx
    lat = lat_min + np.arange(h + 1) * dy
    x_grid, y_grid = np.meshgrid(lon, lat)
    write_net_nc(model_dir / f"{model_name}_net.nc", x_grid, y_grid, node_z)

    # reservoir initial condition: Tekal polygon covering orig rows 0..crest
    # row (gap cells inside start primed at reservoir level; the crest row
    # itself stays dry where bl > level). Downstream face and beyond stay at
    # sini=0 and get clamped to bed level by s1=max(bl,s1) — see docstring.
    n_last = min(max(int(dam_rc[0]), 0), h - 3)
    lat_cut = origin_lat - (n_last + 1) * dy
    lon_east = origin_lon + w * dx
    poly = f"{model_name}_initial.pol"
    with open(model_dir / poly, "w", encoding="utf-8") as f:
        f.write(f"{model_name} reservoir initial water level\n")
        f.write("5 3\n")
        for plon, plat in ((origin_lon, origin_lat), (lon_east, origin_lat),
                           (lon_east, lat_cut), (origin_lon, lat_cut),
                           (origin_lon, origin_lat)):
            f.write(f"{plon:.9f} {plat:.9f} 0.0\n")

    ini_field = f"{model_name}_initial.ini"
    (model_dir / ini_field).write_text(
        "[General]\n"
        "    fileVersion           = 2.02\n"
        "    fileType              = iniField\n"
        "\n"
        "[Initial]\n"
        "    quantity              = initialWaterLevel\n"
        f"    dataFile              = {poly}\n"
        "    dataFileType          = polygon\n"
        "    interpolationMethod   = constant\n"
        "    operand               = override\n"
        f"    value                 = {initial_level_m:.3f}\n",
        encoding="utf-8",
    )

    stop_s = duration_s
    import datetime as dt

    stop = dt.datetime(2026, 1, 1) + dt.timedelta(seconds=stop_s)
    stop_str = stop.strftime("%Y%m%d%H%M%S")
    # Map/HisInterval must be a multiple of DtUser (30 s) or the engine
    # refuses to start; the reader resamples native records onto its own
    # frame grid, so exact frame-count intervals are not required.
    map_interval = max(round(stop_s / max(frames, 1) / 30.0), 1) * 30.0
    lat_mid = abs((origin_lat + lat_min) / 2.0)
    (model_dir / f"{model_name}.mdu").write_text(
        _MDU.format(name=model_name, ini_field=ini_field, ang_lat=lat_mid,
                    stop=stop_str, map_interval=map_interval,
                    his_interval=map_interval),
        encoding="utf-8",
    )
    (model_dir / "dimr_config.xml").write_text(_DIMR.format(name=model_name),
                                               encoding="utf-8")

    manifest = {
        "model_name": model_name,
        "grid": [h, w],
        "crest_m": crest,
        "gap_bottom_m": gap_bottom,
        "initial_level_m": initial_level_m,
        "breach_depth_m": breach_depth_m,
        "duration_s": duration_s,
        "frames": frames,
        "map_interval_s": map_interval,
    }
    (model_dir / "manifest.json").write_text(json.dumps(manifest, indent=2),
                                             encoding="utf-8")
    return manifest
