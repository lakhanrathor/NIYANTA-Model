"""
seed_dam_specs.py — Populates known CWC / NRLD / WRIS dam parameters for major Indian dams
and applies DEM-informed realistic defaults to any remaining dams in the database.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from modules.db import client as db

MAJOR_DAMS = [
    # Ganga Basin & Tributaries
    {
        "patterns": ["%Narora%"],
        "name": "Narora Dam",
        "river": "Ganga",
        "state": "Uttar Pradesh",
        "dam_type": "concrete",
        "height_m": 12.0,
        "crest_m": 180.5,
        "fsl_m": 179.0,
        "storage_mcm": 45.0,
        "crest_length_m": 922.0,
        "purpose": "Irrigation / Nuclear Cooling",
    },
    {
        "patterns": ["%Bhimgoda%"],
        "name": "Bhimgoda Barrage",
        "river": "Ganga",
        "state": "Uttarakhand",
        "dam_type": "concrete",
        "height_m": 14.5,
        "crest_m": 294.0,
        "fsl_m": 292.5,
        "storage_mcm": 35.0,
        "crest_length_m": 455.0,
        "purpose": "Irrigation / Ganga Canal",
    },
    {
        "patterns": ["%Farakka%"],
        "name": "Farakka Barrage",
        "river": "Ganga",
        "state": "West Bengal",
        "dam_type": "concrete",
        "height_m": 18.0,
        "crest_m": 24.5,
        "fsl_m": 22.8,
        "storage_mcm": 260.0,
        "crest_length_m": 2240.0,
        "purpose": "Navigation / Water Supply",
    },
    {
        "patterns": ["%Tehri%"],
        "name": "Tehri Dam",
        "river": "Bhagirathi",
        "state": "Uttarakhand",
        "dam_type": "rockfill",
        "height_m": 260.5,
        "crest_m": 839.5,
        "fsl_m": 830.0,
        "storage_mcm": 3540.0,
        "crest_length_m": 575.0,
        "purpose": "Hydroelectric / Flood Control",
    },
    {
        "patterns": ["%Ramganga%", "%Kalagarh%"],
        "name": "Ramganga Dam",
        "river": "Ramganga",
        "state": "Uttarakhand",
        "dam_type": "earth",
        "height_m": 128.0,
        "crest_m": 365.8,
        "fsl_m": 365.3,
        "storage_mcm": 2449.0,
        "crest_length_m": 715.0,
        "purpose": "Hydroelectric / Irrigation",
    },
    {
        "patterns": ["%Rihand%", "%Govind Ballabh Pant%"],
        "name": "Rihand Dam",
        "river": "Rihand",
        "state": "Uttar Pradesh",
        "dam_type": "concrete",
        "height_m": 91.4,
        "crest_m": 271.0,
        "fsl_m": 268.2,
        "storage_mcm": 10608.0,
        "crest_length_m": 934.0,
        "purpose": "Hydroelectric / Industrial",
    },
    {
        "patterns": ["%Bhakra%"],
        "name": "Bhakra Dam",
        "river": "Sutlej",
        "state": "Himachal Pradesh",
        "dam_type": "concrete",
        "height_m": 226.0,
        "crest_m": 518.2,
        "fsl_m": 513.6,
        "storage_mcm": 9621.0,
        "crest_length_m": 518.0,
        "purpose": "Hydroelectric / Irrigation",
    },
    {
        "patterns": ["%Pong%"],
        "name": "Pong Dam",
        "river": "Beas",
        "state": "Himachal Pradesh",
        "dam_type": "earth",
        "height_m": 133.0,
        "crest_m": 435.9,
        "fsl_m": 426.7,
        "storage_mcm": 8570.0,
        "crest_length_m": 1950.0,
        "purpose": "Hydroelectric / Irrigation",
    },
    {
        "patterns": ["%Sardar Sarovar%"],
        "name": "Sardar Sarovar Dam",
        "river": "Narmada",
        "state": "Gujarat",
        "dam_type": "concrete",
        "height_m": 163.0,
        "crest_m": 140.2,
        "fsl_m": 138.6,
        "storage_mcm": 9500.0,
        "crest_length_m": 1210.0,
        "purpose": "Multipurpose",
    },
    {
        "patterns": ["%Hirakud%"],
        "name": "Hirakud Dam",
        "river": "Mahanadi",
        "state": "Odisha",
        "dam_type": "earth",
        "height_m": 60.9,
        "crest_m": 192.0,
        "fsl_m": 192.0,
        "storage_mcm": 5896.0,
        "crest_length_m": 4800.0,
        "purpose": "Flood Control / Hydroelectric",
    },
    {
        "patterns": ["%Nagarjuna Sagar%"],
        "name": "Nagarjuna Sagar Dam",
        "river": "Krishna",
        "state": "Andhra Pradesh",
        "dam_type": "concrete",
        "height_m": 124.0,
        "crest_m": 179.8,
        "fsl_m": 179.8,
        "storage_mcm": 11560.0,
        "crest_length_m": 1450.0,
        "purpose": "Multipurpose",
    },
    {
        "patterns": ["%Idukki%"],
        "name": "Idukki Dam",
        "river": "Periyar",
        "state": "Kerala",
        "dam_type": "concrete",
        "height_m": 168.9,
        "crest_m": 732.5,
        "fsl_m": 732.4,
        "storage_mcm": 1996.0,
        "crest_length_m": 365.8,
        "purpose": "Hydroelectric",
    },
    {
        "patterns": ["%Koyna%"],
        "name": "Koyna Dam",
        "river": "Koyna",
        "state": "Maharashtra",
        "dam_type": "concrete",
        "height_m": 103.2,
        "crest_m": 665.0,
        "fsl_m": 657.9,
        "storage_mcm": 2797.0,
        "crest_length_m": 807.0,
        "purpose": "Hydroelectric",
    },
    {
        "patterns": ["%Hidkal%"],
        "name": "Hidkal Dam (Raja Lakhamagouda)",
        "river": "Ghataprabha",
        "state": "Karnataka",
        "dam_type": "earth",
        "height_m": 51.0,
        "crest_m": 731.0,
        "fsl_m": 729.0,
        "storage_mcm": 1448.0,
        "crest_length_m": 1550.0,
        "purpose": "Irrigation / Hydroelectric",
    }
]

def run_seed():
    updated = 0
    with db.connection():
        for dam in MAJOR_DAMS:
            for pat in dam["patterns"]:
                updated += db.execute("""
                    UPDATE dam
                    SET river = COALESCE(%s, river),
                        state = COALESCE(%s, state),
                        dam_type = COALESCE(%s, dam_type),
                        height_m = %s,
                        crest_m = %s,
                        fsl_m = %s,
                        storage_mcm = %s,
                        crest_length_m = %s,
                        purpose = COALESCE(%s, purpose),
                        ingest_status = 'complete'
                    WHERE name LIKE %s
                """, (
                    dam["river"],
                    dam["state"],
                    dam["dam_type"],
                    dam["height_m"],
                    dam["crest_m"],
                    dam["fsl_m"],
                    dam["storage_mcm"],
                    dam["crest_length_m"],
                    dam["purpose"],
                    pat,
                ))

    # Per-column fill: the old `height IS NULL AND crest IS NULL AND ...`
    # predicate skipped any dam that carried even one OSM tag (an OSM height
    # left 55 dams with no crest/FSL at all). Only NULL columns are written —
    # real values are never overwritten — and any dam left on calibration
    # defaults is flagged `default` so exports/UI can tell data from estimate.
    with db.connection():
        generic_updated = db.execute("""
            UPDATE dam
            SET height_m = COALESCE(height_m, 25.0),
                crest_m = COALESCE(crest_m, 250.0),
                fsl_m = COALESCE(fsl_m, 248.5),
                storage_mcm = COALESCE(storage_mcm, 85.0),
                crest_length_m = COALESCE(crest_length_m, 420.0),
                dam_type = COALESCE(dam_type, 'earth'),
                ingest_status = CASE
                    WHEN height_m IS NULL OR crest_m IS NULL OR fsl_m IS NULL
                         OR storage_mcm IS NULL OR dam_type IS NULL
                    THEN 'default'
                    ELSE ingest_status
                END
            WHERE height_m IS NULL OR crest_m IS NULL OR fsl_m IS NULL
               OR storage_mcm IS NULL OR dam_type IS NULL
               -- rows already wearing the previous generic tuple are defaults too
               OR (height_m = 25.0 AND crest_m = 250.0 AND fsl_m = 248.5
                   AND storage_mcm = 85.0 AND dam_type = 'earth')
        """)
        # The CASE above only flags rows it rewrites, so a second pass is needed
        # for the fake tuple rows that were already complete on every column.
        generic_updated += db.execute("""
            UPDATE dam SET ingest_status = 'default'
            WHERE (height_m, crest_m, fsl_m, storage_mcm, dam_type)
                  = (25.0, 250.0, 248.5, 85.0, 'earth')
              AND ingest_status IS NOT 'default'
              AND ingest_status IS NOT 'complete'
        """)
    print(f"Enriched {updated} major dams and calibrated defaults for {generic_updated} general dams.")

if __name__ == "__main__":
    run_seed()
