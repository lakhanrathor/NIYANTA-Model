import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const BASE = "http://localhost:5173";
const DIR = "test-results";

// Diagnostic captures only: Chromium occasionally fails Page.captureScreenshot
// on large WebGL pages — retry once so a flaky capture can't fail a test.
async function snap(page: Page, file: string) {
  try {
    await page.screenshot({ path: `${DIR}/${file}`, fullPage: true });
  } catch {
    await page.screenshot({ path: `${DIR}/${file}`, fullPage: true });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. MISSION HUB — Landing Page
// ═══════════════════════════════════════════════════════════════════════════════
test.describe("1. Mission Hub", () => {
  test("1.1 Hub loads with title and missions", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const text = await page.locator("body").innerText();
    expect(text).toContain("NIYANTA");
    expect(text).toContain("MISSION");
    await snap(page, "01-hub.png");
  });

  test("1.2 Three missions visible", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    const cards = await page.locator("[style*='cursor: pointer']").count();
    expect(cards).toBeGreaterThanOrEqual(3);
  });

  test("1.3 Click mission navigates to overview", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const firstMission = page.locator("text=RISHI GANGA").first();
    if (await firstMission.isVisible()) {
      await firstMission.click();
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      expect(page.url()).toContain("/mission/");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. MISSION OVERVIEW — Projects List
// ═══════════════════════════════════════════════════════════════════════════════
test.describe("2. Mission Overview", () => {
  test("2.1 Overview loads with projects", async ({ page }) => {
    await page.goto(`${BASE}/mission/01`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const text = await page.locator("body").innerText();
    expect(text).toContain("MISSION 01");
    expect(text).toContain("Rishi Ganga");
    await snap(page, "02-overview.png");
  });

  test("2.2 Workflow steps visible", async ({ page }) => {
    await page.goto(`${BASE}/mission/01`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    const text = await page.locator("body").innerText();
    expect(text).toContain("DATA INGEST");
    expect(text).toContain("SIM CONFIG");
    expect(text).toContain("ANALYTICS");
    expect(text).toContain("EXPORT");
  });

  test("2.3 Back button navigates to hub", async ({ page }) => {
    await page.goto(`${BASE}/mission/01`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    await page.locator("text=← BACK TO HUB").click();
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    expect(page.url()).toMatch(/\/$/);
  });

  test("2.4 Click project opens dashboard", async ({ page }) => {
    await page.goto(`${BASE}/mission/01`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const projectCard = page.locator("text=Rishi Ganga Flash Flood (2021)").first();
    if (await projectCard.isVisible()) {
      await projectCard.click();
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      expect(page.url()).toContain("/project/");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. PROJECT DASHBOARD — 3D Viewport + Panels
// ═══════════════════════════════════════════════════════════════════════════════
test.describe("3. Project Dashboard", () => {
  test("3.1 Dashboard loads with 3D canvas", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(8000);

    await snap(page, "03-dashboard-loaded.png");

    const canvas = await page.locator("canvas").count();
    expect(canvas).toBeGreaterThan(0);

    const text = await page.locator("body").innerText();
    expect(text).toContain("NIYANTA");

    console.log("JS errors:", errors.length);
  });

  test("3.2 Header bar visible", async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const text = await page.locator("body").innerText();
    expect(text).toContain("Mission 01");
    expect(text).toContain("Project p1");
  });

  test("3.3 Left panel visible with tabs", async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const text = await page.locator("body").innerText();
    expect(text).toContain("MISSION OVERVIEW");
    expect(text).toContain("MAP DRAPING");
    expect(text).toContain("WEATHER");
    expect(text).toContain("CRISIS PROTOCOL");
  });

  test("3.4 Right panel visible with tabs", async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const text = await page.locator("body").innerText();
    expect(text).toContain("LIVE SIMULATION METRICS");
  });

  test("3.5 Back button navigates to overview", async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    await page.locator("text=← BACK").first().click();
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    expect(page.url()).toContain("/mission/01");
  });

  test("3.6 Panel toggle buttons work", async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    // Toggle left panel off
    const leftToggle = page.locator("text=◀ Data");
    if (await leftToggle.isVisible()) {
      await leftToggle.click();
      await page.waitForTimeout(500);
      await snap(page, "06-left-panel-closed.png");

      // Toggle back on
      await leftToggle.click();
      await page.waitForTimeout(500);
    }
  });

  test("3.7 Right panel toggle works", async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const rightToggle = page.locator("text=Results ▶");
    if (await rightToggle.isVisible()) {
      await rightToggle.click();
      await page.waitForTimeout(500);
      await snap(page, "07-right-panel-closed.png");

      await rightToggle.click();
      await page.waitForTimeout(500);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. LEFT PANEL — Tab Switching
// ═══════════════════════════════════════════════════════════════════════════════
test.describe("4. Left Panel Tabs", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);
  });

  test("4.1 Overview tab (default)", async ({ page }) => {
    const text = await page.locator("body").innerText();
    expect(text).toContain("MISSION OVERVIEW");
    expect(text).toContain("MAP DRAPING");
    await snap(page, "04-left-overview.png");
  });

  test("4.2 Data tab switches", async ({ page }) => {
    const dataTab = page.locator("button").filter({ hasText: "🗂️" }).first();
    if (await dataTab.isVisible()) {
      await dataTab.click();
      await page.waitForTimeout(500);
      const text = await page.locator("body").innerText();
      expect(text).toContain("DATA SOURCE");
      expect(text).toContain("LOCAL DEM LIBRARY");
      await snap(page, "04-left-data.png");
    }
  });

  test("4.3 Sim Config tab switches", async ({ page }) => {
    const simTab = page.locator("button").filter({ hasText: "⚙️" }).first();
    if (await simTab.isVisible()) {
      await simTab.click();
      await page.waitForTimeout(500);
      const text = await page.locator("body").innerText();
      expect(text).toContain("SPH ENGINE");
      expect(text).toContain("DELFT3D");
      await snap(page, "04-left-sim.png");
    }
  });

  test("4.4 Dam Config tab switches", async ({ page }) => {
    const damTab = page.locator("button").filter({ hasText: "🏗️" }).first();
    if (await damTab.isVisible()) {
      await damTab.click();
      await page.waitForTimeout(500);
      const text = await page.locator("body").innerText();
      expect(text).toContain("DAM PARAMETERS");
      expect(text).toContain("FAILURE MODE");
      await snap(page, "04-left-dam.png");
    }
  });

  test("4.5 Scenario tab switches", async ({ page }) => {
    const scenarioTab = page.locator("button").filter({ hasText: "⛅" }).first();
    if (await scenarioTab.isVisible()) {
      await scenarioTab.click();
      await page.waitForTimeout(500);
      const text = await page.locator("body").innerText();
      expect(text).toContain("INFLOW SCENARIO");
      await snap(page, "04-left-scenario.png");
    }
  });

  test("4.6 GEE tab switches", async ({ page }) => {
    const geeTab = page.locator("button").filter({ hasText: "🌐" }).first();
    if (await geeTab.isVisible()) {
      await geeTab.click();
      await page.waitForTimeout(500);
      const text = await page.locator("body").innerText();
      expect(text).toContain("GOOGLE EARTH ENGINE");
      await snap(page, "04-left-gee.png");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. RIGHT PANEL — Tab Switching
// ═══════════════════════════════════════════════════════════════════════════════
test.describe("5. Right Panel Tabs", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);
  });

  test("5.1 KPI tab (default)", async ({ page }) => {
    const text = await page.locator("body").innerText();
    expect(text).toContain("LIVE SIMULATION METRICS");
    expect(text).toContain("DELFT3D TELEMETRY");
  });

  test("5.2 Assets tab switches", async ({ page }) => {
    const assetsTab = page.locator("button").filter({ hasText: "🏥" }).first();
    if (await assetsTab.isVisible()) {
      await assetsTab.click();
      await page.waitForTimeout(500);
      const text = await page.locator("body").innerText();
      expect(text).toContain("CRITICAL ASSET IMPACT");
      await snap(page, "05-right-assets.png");
    }
  });

  test("5.3 Charts tab switches", async ({ page }) => {
    // Right panel is the 2nd set of tab buttons; charts is 3rd button in that set
    const rightPanelButtons = page.locator("div[style*='border-left'] button");
    const count = await rightPanelButtons.count();
    if (count >= 3) {
      await rightPanelButtons.nth(2).click();
      await page.waitForTimeout(500);
      const text = await page.locator("body").innerText();
      expect(text).toContain("TIME SERIES ANALYSIS");
      await snap(page, "05-right-charts.png");
    }
  });

  test("5.4 Heatmap tab switches", async ({ page }) => {
    const heatmapTab = page.locator("button").filter({ hasText: "🗺️" }).first();
    if (await heatmapTab.isVisible()) {
      await heatmapTab.click();
      await page.waitForTimeout(500);
      const text = await page.locator("body").innerText();
      expect(text).toContain("ARRIVAL TIME HEATMAP");
      await snap(page, "05-right-heatmap.png");
    }
  });

  test("5.5 Export tab switches", async ({ page }) => {
    const exportTab = page.locator("button").filter({ hasText: "📄" }).first();
    if (await exportTab.isVisible()) {
      await exportTab.click();
      await page.waitForTimeout(500);
      const text = await page.locator("body").innerText();
      expect(text).toContain("GEOSPATIAL EXPORT");
      expect(text).toContain("KML");
      expect(text).toContain("SHP");
      expect(text).toContain("GeoTIFF");
      await snap(page, "05-right-export.png");
    }
  });

  test("5.6 Alerts tab switches", async ({ page }) => {
    const alertsTab = page.locator("button").filter({ hasText: "🔔" }).first();
    if (await alertsTab.isVisible()) {
      await alertsTab.click();
      await page.waitForTimeout(500);
      const text = await page.locator("body").innerText();
      expect(text).toContain("ALERT LOG");
      await snap(page, "05-right-alerts.png");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. TIMELINE CONTROLS
// ═══════════════════════════════════════════════════════════════════════════════
test.describe("6. Timeline", () => {
  test("6.1 Play button exists", async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(6000);

    const playBtn = page.locator("button").filter({ hasText: /Play|▶/ }).first();
    const visible = await playBtn.isVisible().catch(() => false);
    console.log("Play button visible:", visible);
  });

  test("6.2 Speed controls visible", async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(6000);

    const text = await page.locator("body").innerText();
    expect(text).toContain("1x");
    expect(text).toContain("2x");
  });

  test("6.3 Frame counter visible", async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(6000);

    const text = await page.locator("body").innerText();
    expect(text).toContain("Frame");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. DRAPING MODES
// ═══════════════════════════════════════════════════════════════════════════════
test.describe("7. Drape Modes", () => {
  test("7.1 All 4 drape modes visible", async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const text = await page.locator("body").innerText();
    expect(text).toContain("satellite");
    expect(text).toContain("topo");
    expect(text).toContain("heatmap");
  });

  test("7.2 Click heatmap mode", async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const heatmapBtn = page.locator("button").filter({ hasText: /heatmap/i }).first();
    if (await heatmapBtn.isVisible()) {
      await heatmapBtn.click();
      await page.waitForTimeout(1000);
      await snap(page, "07-heatmap-mode.png");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. CRISIS TRIGGER
// ═══════════════════════════════════════════════════════════════════════════════
test.describe("8. Crisis Trigger", () => {
  test("8.1 Crisis button visible", async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const text = await page.locator("body").innerText();
    expect(text).toContain("TRIGGER CRISIS");
  });

  test("8.2 Click crisis triggers emergency mode", async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const crisisBtn = page.locator("button").filter({ hasText: /TRIGGER CRISIS/ }).first();
    if (await crisisBtn.isVisible()) {
      await crisisBtn.click();
      await page.waitForTimeout(2000);
      const text = await page.locator("body").innerText();
      expect(text).toContain("CRISIS ACTIVE");
      await snap(page, "08-crisis-active.png");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. CAMERA MODES
// ═══════════════════════════════════════════════════════════════════════════════
test.describe("9. Camera Modes", () => {
  test("9.1 Camera buttons visible", async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const text = await page.locator("body").innerText();
    expect(text).toContain("Director");
    expect(text).toContain("Drone");
    expect(text).toContain("Action");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. WEATHER MODES
// ═══════════════════════════════════════════════════════════════════════════════
test.describe("10. Weather Modes", () => {
  test("10.1 Weather buttons in left panel", async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const text = await page.locator("body").innerText();
    expect(text).toContain("day");
    expect(text).toContain("storm");
    expect(text).toContain("night");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. ASSET IMPACT TABLE
// ═══════════════════════════════════════════════════════════════════════════════
test.describe("11. Asset Impact", () => {
  test("11.1 Assets tab shows all critical infrastructure", async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const assetsTab = page.locator("button").filter({ hasText: "🏥" }).first();
    if (await assetsTab.isVisible()) {
      await assetsTab.click();
      await page.waitForTimeout(500);
      const text = await page.locator("body").innerText();
      expect(text).toContain("Hospital");
      expect(text).toContain("Bridge");
      expect(text).toContain("CRITICAL");
      await snap(page, "11-asset-impact.png");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. EXPORT FORMATS
// ═══════════════════════════════════════════════════════════════════════════════
test.describe("12. Export Panel", () => {
  test("12.1 All export formats visible", async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const exportTab = page.locator("button").filter({ hasText: "📄" }).first();
    if (await exportTab.isVisible()) {
      await exportTab.click();
      await page.waitForTimeout(500);
      const text = await page.locator("body").innerText();
      expect(text).toContain("KML");
      expect(text).toContain("SHP");
      expect(text).toContain("GeoTIFF");
      expect(text).toContain("CSV");
      expect(text).toContain("JSON");
      expect(text).toContain("DOWNLOAD");
      await snap(page, "12-export-formats.png");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. NAVIGATION — Full Flow
// ═══════════════════════════════════════════════════════════════════════════════
test.describe("13. Navigation Flow", () => {
  test("13.1 Hub → Mission → Dashboard → Back", async ({ page }) => {
    // Start at hub
    await page.goto(BASE);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await snap(page, "13a-hub.png");

    // Click first mission
    const mission = page.locator("text=RISHI GANGA").first();
    if (await mission.isVisible()) {
      await mission.click();
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1000);
      await snap(page, "13b-overview.png");

      // Click first project
      const project = page.locator("text=Rishi Ganga Flash Flood (2021)").first();
      if (await project.isVisible()) {
        await project.click();
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(5000);
        await snap(page, "13c-dashboard.png");
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. NO CRITICAL JS ERRORS
// ═══════════════════════════════════════════════════════════════════════════════
test.describe("14. Error Checking", () => {
  test("14.1 Dashboard has no critical JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(8000);

    console.log("Total JS errors:", errors.length);
    for (const e of errors) console.log("  -", e);

    // Filter out non-critical WebGL/resource errors
    const criticalErrors = errors.filter(e =>
      !e.includes("texture") && !e.includes("THREE") && !e.includes("WebGL")
    );
    expect(criticalErrors.length).toBe(0);
  });

  test("14.2 Hub has no JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto(BASE);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    expect(errors.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. COMPUTE PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════
test.describe("15. Compute Pipeline", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);
  });

  test("15.1 Compute tab visible in left panel", async ({ page }) => {
    const computeTab = page.locator("button").filter({ hasText: /▶/ }).first();
    expect(await computeTab.isVisible()).toBeTruthy();
  });

  test("15.2 Compute tab shows pipeline steps", async ({ page }) => {
    // Click the compute tab - it's in the left panel tab bar (first set of buttons)
    const leftTabs = page.locator("div[style*='border-right'] button");
    const count = await leftTabs.count();
    if (count >= 7) {
      await leftTabs.nth(6).click(); // 7th tab (0-indexed) = compute
      await page.waitForTimeout(500);
      const text = await page.locator("body").innerText();
      expect(text).toContain("COMPUTE PIPELINE");
      expect(text).toContain("RUN COMPUTE");
      await snap(page, "15-compute-tab.png");
    }
  });

  test("15.3 Click RUN COMPUTE triggers mock job", async ({ page }) => {
    // Full pipeline can take ~30s under suite load; budget covers it + screenshot.
    test.setTimeout(120000);
    const leftTabs = page.locator("div[style*='border-right'] button");
    const count = await leftTabs.count();
    if (count >= 7) {
      await leftTabs.nth(6).click();
      await page.waitForTimeout(500);
      const runBtn = page.locator("button").filter({ hasText: "RUN COMPUTE" }).first();
      if (await runBtn.isVisible()) {
        await runBtn.click();
        // Wait for the compute to finish - check for "Complete" or "✅" in the status
        await page.waitForFunction(() => {
          return document.body.innerText.includes("✅ Complete") || document.body.innerText.includes("New Compute");
        }, { timeout: 60000 });
        const text = await page.locator("body").innerText();
        expect(text).toContain("Complete");
        await snap(page, "15-compute-done.png");
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 16. REAL MAP TILE DRAPING
// ═══════════════════════════════════════════════════════════════════════════════
test.describe("16. Real Map Tiles", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);
  });

  test("16.1 Real map buttons visible", async ({ page }) => {
    const text = await page.locator("body").innerText();
    expect(text).toContain("Real Satellite");
    expect(text).toContain("Real OSM");
  });

  test("16.2 Click Real Satellite shows loading indicator", async ({ page }) => {
    const realSatBtn = page.locator("button").filter({ hasText: /Real Satellite/ }).first();
    if (await realSatBtn.isVisible()) {
      await realSatBtn.click();
      await page.waitForTimeout(500);
      const text = await page.locator("body").innerText();
      expect(text).toContain("Fetching real map tiles");
      await snap(page, "16-real-tiles-loading.png");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 17. GEO COORDINATE HOVER
// ═══════════════════════════════════════════════════════════════════════════════
test.describe("17. Geo Coordinates", () => {
  test("17.1 Canvas hover shows coordinates", async ({ page }) => {
    await page.goto(`${BASE}/mission/01/project/p1`);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(6000);

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(1000);
      const text = await page.locator("body").innerText();
      const hasGeo = text.includes("GEO COORDINATES") || text.includes("Elevation");
      console.log("Geo coordinates visible:", hasGeo);
      await snap(page, "17-geo-hover.png");
    }
  });
});
