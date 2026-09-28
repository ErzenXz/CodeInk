import { expect, test } from "@playwright/test"
import {
  buildInitialStreamEvent,
  buildStreamDeltaEvents,
  setupTimelineBenchmark,
} from "../performance/timeline/session-timeline-benchmark.fixture"

test("an upward scroll remains in place while a reply streams", async ({ page }) => {
  const fixture = await setupTimelineBenchmark(page, {
    historyTurns: 24,
    eventBatch: 1,
    newLayoutDesigns: true,
  })
  fixture.transport.enqueue(buildInitialStreamEvent(2))
  await expect(fixture.text).toContainText("Streaming")
  await fixture.scrollToBottom()
  await fixture.waitForStableGeometry()

  await fixture.scroller.evaluate((element) =>
    element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -250 })),
  )
  await fixture.scroller.evaluate((element) => {
    element.scrollTop -= 250
    element.dispatchEvent(new Event("scroll", { bubbles: true }))
  })
  fixture.transport.enqueue(buildStreamDeltaEvents(2)[0]!)
  await expect.poll(() => fixture.transport.pendingCount()).toBe(0)
  await expect
    .poll(() =>
      fixture.scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
    )
    .toBeGreaterThan(100)
})

test("dragging the timeline scrollbar pauses auto-follow", async ({ page }) => {
  const fixture = await setupTimelineBenchmark(page, {
    historyTurns: 24,
    eventBatch: 1,
    newLayoutDesigns: true,
  })
  fixture.transport.enqueue(buildInitialStreamEvent(1))
  await expect(fixture.text).toContainText("Streaming")
  await fixture.scrollToBottom()
  await fixture.waitForStableGeometry()

  await fixture.scroller.hover()
  const thumb = fixture.scroller.locator("xpath=..").locator(".scroll-view__thumb")
  const bounds = await thumb.boundingBox()
  if (!bounds) throw new Error("Timeline scrollbar thumb is missing")
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y - 120, { steps: 5 })
  await page.mouse.up()

  fixture.transport.enqueue(buildStreamDeltaEvents(1)[0]!)
  await expect.poll(() => fixture.transport.pendingCount()).toBe(0)
  await expect
    .poll(() =>
      fixture.scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
    )
    .toBeGreaterThan(100)
})

test("a large streamed chunk appears without a paced backlog", async ({ page }) => {
  const fixture = await setupTimelineBenchmark(page, {
    historyTurns: 4,
    eventBatch: 1,
    newLayoutDesigns: true,
  })
  fixture.transport.enqueue(buildInitialStreamEvent(1))
  await expect(fixture.text).toContainText("Streaming")

  const event = buildStreamDeltaEvents(1)[0]!
  event.payload.properties.delta = `\n\n${"word ".repeat(6000)}END_OF_STREAM_MARKER`
  const started = Date.now()
  fixture.transport.enqueue(event)
  await expect(fixture.text).toContainText("END_OF_STREAM_MARKER", { timeout: 10_000 })
  expect(Date.now() - started).toBeLessThan(1500)
})

test("a running tool keeps its row when another tool arrives", async ({ page }) => {
  const fixture = await setupTimelineBenchmark(page, {
    historyTurns: 4,
    eventBatch: 1,
    newLayoutDesigns: true,
  })
  const editID = "prt_0001_edit"
  await expect(page.locator(`[data-timeline-part-id="${editID}"]`)).toBeVisible()
  await page.evaluate((id) => {
    ;(window as Window & { __firstTool?: Element | null }).__firstTool = document.querySelector(
      `[data-timeline-part-id="${id}"]`,
    )
  }, editID)

  fixture.transport.enqueue({
    directory: "C:/OpenCode/TimelineStateRegression",
    payload: {
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_0002_read",
          sessionID: "ses_timeline_state_regression",
          messageID: "msg_assistant_regression",
          type: "tool",
          callID: "call_read_streaming",
          tool: "read",
          state: { status: "running", input: { filePath: "src/next.ts" }, time: { start: 1700000003000 } },
        },
      },
    },
  })
  await expect.poll(() => fixture.transport.pendingCount()).toBe(0)
  await expect(page.locator('[data-timeline-part-id="prt_0002_read"]')).toBeVisible()
  expect(await page.evaluate(() => (window as Window & { __firstTool?: Element | null }).__firstTool?.isConnected)).toBe(
    true,
  )
})
