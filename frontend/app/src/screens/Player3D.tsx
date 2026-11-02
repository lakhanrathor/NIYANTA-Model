import { useState } from 'react'
import { PlayerProvider } from './player/PlayerProvider'
import { RunIdentityPanel } from './player/RunIdentityPanel'
import { ViewModePanel } from './player/ViewModePanel'
import { LayersPanel } from './player/LayersPanel'
import { SceneControlsPanel } from './player/SceneControlsPanel'
import { CameraPanel } from './player/CameraPanel'
import { Viewport } from './player/Viewport'
import { PlaybackBar } from './player/PlaybackBar'
import { LiveMetricsBar } from './player/LiveMetricsBar'
import { LiveStatsPanel } from './player/LiveStatsPanel'
import { SimulationPanel } from './player/SimulationPanel'
import { AffectedPanel } from './player/AffectedPanel'
import { VillagesPanel } from './player/VillagesPanel'
import { HydrographPanel } from './player/HydrographPanel'
import { GaugesPanel } from './player/GaugesPanel'
import { CascadePanel } from './player/CascadePanel'
import { ProbePanel } from './player/ProbePanel'
import { ExportPanel } from './player/ExportPanel'
import { RailGroup } from '../components/rail'

/**
 * PLAYER — 3D cinematic view of one run. This file only composes the page:
 * shared data + scene state live in `player/PlayerProvider`, every panel is
 * its own module under `player/`, and the three.js scene in `PlayerScene`.
 * A change to one panel touches exactly one file.
 */
export function Player3D() {
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)

  return (
    <PlayerProvider>
      <div className="flex h-full gap-2 overflow-hidden bg-[var(--bg-subtle)] p-2">
        {/* -------------------------------------------------------- LEFT */}
        <div
          className={`flex min-h-0 flex-col gap-2 overflow-y-auto transition-all ${leftOpen ? 'w-[284px] shrink-0' : 'w-0 overflow-hidden'}`}
        >
          <RailGroup id="player.left">
            <RunIdentityPanel />
            <ViewModePanel />
            <LayersPanel />
            <SceneControlsPanel />
            <CameraPanel />
          </RailGroup>
        </div>

        {/* ------------------------------------------------------ CENTRE */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <Viewport
            leftOpen={leftOpen}
            onShowLeft={() => setLeftOpen(true)}
            onHideLeft={() => setLeftOpen(false)}
            rightOpen={rightOpen}
            onShowRight={() => setRightOpen(true)}
            onHideRight={() => setRightOpen(false)}
          />
          <LiveMetricsBar />
          <PlaybackBar />
        </div>

        {/* ------------------------------------------------------- RIGHT */}
        <div
          className={`flex min-h-0 flex-col gap-2 overflow-y-auto transition-all ${rightOpen ? 'w-[318px] shrink-0' : 'w-0 overflow-hidden'}`}
        >
          {/* click answers (probe / asset) sit high so a click shows its result */}
          <RailGroup id="player.right">
            <LiveStatsPanel />
            <ProbePanel />
            <AffectedPanel />
            <VillagesPanel />
            <SimulationPanel />
            <HydrographPanel />
            <GaugesPanel />
            <CascadePanel />
            <ExportPanel />
          </RailGroup>
        </div>
      </div>
    </PlayerProvider>
  )
}
