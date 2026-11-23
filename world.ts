/**
 * 物理/桌面在场感知 MSP World（移植自 jingxi-coopanion-worlds / world-are-you-there）：
 * - 融合锁屏状态、键鼠空闲时间与可选 24GHz 毫米波人体存在雷达
 * - 工具：presence_state
 * - 信号：here.state, here.changed
 */
import type { MSPNode } from "../shared/msp.ts";

export interface PresenceReading {
  locked: boolean;
  idleSeconds: number;
  radarPresent?: boolean;
}

export type PresenceStatus = "present" | "away" | "uncertain";

export class PresenceWorld {
  private readonly readSensors: () => Promise<PresenceReading>;
  private readonly idleThresholdSec: number;
  private readonly pollIntervalMs: number;
  private node: MSPNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastStatus: PresenceStatus | null = null;
  private latest: { status: PresenceStatus; reading: PresenceReading; updatedAt: string } | null = null;

  constructor(
    config: { idleThresholdSec?: number; pollIntervalMs?: number } = {},
    readSensors?: () => Promise<PresenceReading>,
  ) {
    this.idleThresholdSec = config.idleThresholdSec ?? 180;
    this.pollIntervalMs = config.pollIntervalMs ?? 5000;
    this.readSensors =
      readSensors ?? (async () => ({ locked: false, idleSeconds: 0, radarPresent: undefined }));
  }

  attach(node: MSPNode): void {
    this.node = node;
    node.declareSignal("here.state", "当前人体/桌面在场状态快照");
    node.declareSignal("here.changed", "在场状态在 present / away / uncertain 之间切换");

    node.tool(
      "presence_state",
      "读取当前用户在场状态（融合锁屏、键鼠空闲与毫米波雷达）",
      async () => {
        await this.pollOnce();
        return this.latest as unknown as Record<string, unknown>;
      },
      { type: "object", additionalProperties: false, properties: {} },
    );
  }

  start(): void {
    if (this.timer) return;
    void this.pollOnce();
    if (this.pollIntervalMs > 0) {
      this.timer = setInterval(() => void this.pollOnce(), this.pollIntervalMs);
      this.timer.unref?.();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async pollOnce(): Promise<void> {
    const reading = await this.readSensors();
    let status: PresenceStatus;
    if (reading.locked) {
      status = "away";
    } else if (reading.radarPresent === true) {
      status = "present";
    } else if (reading.idleSeconds >= this.idleThresholdSec) {
      status = reading.radarPresent === false ? "away" : "uncertain";
    } else {
      status = "present";
    }

    const updatedAt = new Date().toISOString();
    this.latest = { status, reading, updatedAt };
    this.node?.publish("here.state", this.latest);
    if (this.lastStatus !== null && this.lastStatus !== status) {
      this.node?.publish("here.changed", { from: this.lastStatus, to: status, reading, updatedAt });
    }
    this.lastStatus = status;
  }
}
