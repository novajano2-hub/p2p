import { serverAnswered } from "@/lib/reachability";

import { RealtimeClient, type ConnectionState } from "./client";

/*
  The socket client against a socket that does what it is told, with the clock
  in the test's hands: what a person is shown while the connection is down,
  how a connection that died without saying so is found out, and how a tab
  comes back.
*/

jest.mock("@/lib/api-origin", () => ({ apiOrigin: () => "http://api.test" }));

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static all: FakeSocket[] = [];
  /** A live server answers a ping. A connection that died without saying so does not. */
  static answering = true;

  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
    if (FakeSocket.answering && data === JSON.stringify({ type: "ping" }))
      this.say({ type: "pong" });
  }

  /** The browser's own close(): the socket is gone as far as this tab is concerned. */
  close(): void {
    this.readyState = FakeSocket.CLOSED;
  }

  /* What the test makes the other end do. */
  accept(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  say(frame: object): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  drop(code = 1006): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code });
  }
}

const latest = (): FakeSocket => {
  const socket = FakeSocket.all.at(-1);
  if (!socket) throw new Error("no socket was opened");
  return socket;
};
const pings = (socket: FakeSocket): number =>
  socket.sent.filter((frame) => frame === JSON.stringify({ type: "ping" })).length;

describe("the live connection", () => {
  let client: RealtimeClient;
  let shown: ConnectionState[];

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Math, "random").mockReturnValue(0.5);
    FakeSocket.all = [];
    FakeSocket.answering = true;
    const listeners = { addEventListener: () => undefined, removeEventListener: () => undefined };
    Object.assign(globalThis, {
      window: {
        ...listeners,
        setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
        clearTimeout: (id: NodeJS.Timeout) => clearTimeout(id),
      },
      document: { ...listeners, visibilityState: "visible" },
      WebSocket: FakeSocket,
    });
    client = new RealtimeClient("ws://api.test/v1/ws");
    shown = [];
    client.subscribeState(() => shown.push(client.state));
  });

  afterEach(() => {
    client.close();
    jest.useRealTimers();
    jest.restoreAllMocks();
    for (const name of ["window", "document", "WebSocket"]) {
      delete (globalThis as Record<string, unknown>)[name];
    }
  });

  it("says nothing about a drop the first attempts mend", () => {
    client.connect();
    latest().accept();
    latest().drop();
    jest.advanceTimersByTime(1_500);
    latest().accept();

    jest.advanceTimersByTime(60_000);
    expect(shown).not.toContain("reconnecting");
    expect(client.state).toBe("open");
  });

  it("says it is reconnecting once it has been down a while, and keeps saying so until it is back", () => {
    client.connect();
    latest().accept();
    shown.length = 0;
    latest().drop();

    // Every attempt to come back is turned away, for a minute.
    const end = Date.now() + 60_000;
    while (Date.now() < end) {
      jest.advanceTimersByTime(250);
      const socket = latest();
      if (socket.readyState === FakeSocket.CONNECTING) socket.drop();
    }
    expect(FakeSocket.all.length).toBeGreaterThan(4);

    // Not before ten seconds, and then without a break: a line that comes and goes
    // with every failed attempt reads as a new problem each time.
    const first = shown.indexOf("reconnecting");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(shown.slice(first).every((state) => state === "reconnecting")).toBe(true);

    jest.advanceTimersByTime(31_000);
    latest().accept();
    expect(client.state).toBe("open");
  });

  it("waits ten seconds before it says so", () => {
    client.connect();
    latest().accept();
    latest().drop();
    const turnAway = () => {
      const socket = latest();
      if (socket.readyState === FakeSocket.CONNECTING) socket.drop();
    };
    for (let elapsed = 0; elapsed < 9_500; elapsed += 250) {
      jest.advanceTimersByTime(250);
      turnAway();
    }
    expect(shown).not.toContain("reconnecting");
    jest.advanceTimersByTime(1_000);
    expect(client.state).toBe("reconnecting");
  });

  it("asks a quiet connection whether it is there, and takes any answer", () => {
    client.connect();
    const socket = latest();
    socket.accept();

    jest.advanceTimersByTime(24_000);
    expect(pings(socket)).toBe(0);
    jest.advanceTimersByTime(1_500);
    expect(pings(socket)).toBe(1);

    // Answered, so it stays, and is asked again only after another quiet stretch.
    jest.advanceTimersByTime(20_000);
    expect(client.state).toBe("open");
    expect(FakeSocket.all).toHaveLength(1);
    expect(pings(socket)).toBe(1);

    // A connection that is talking is not asked.
    for (let i = 0; i < 6; i++) {
      socket.say({ type: "typing", tradeId: "t1", userId: "u2" });
      jest.advanceTimersByTime(10_000);
    }
    expect(pings(socket)).toBe(1);
  });

  it("gives up a connection that does not answer, and comes straight back", () => {
    const heard: string[] = [];
    client.on("disconnected", () => heard.push("disconnected"));
    client.on("connected", () => heard.push("connected"));
    client.connect();
    const dead = latest();
    dead.accept();
    FakeSocket.answering = false;

    // Asleep, a tunnel, a changed network: the socket still says OPEN and nothing arrives.
    jest.advanceTimersByTime(25_000 + 10_000 + 100);
    expect(dead.readyState).toBe(FakeSocket.CLOSED);
    expect(heard).toEqual(["connected", "disconnected"]);

    jest.advanceTimersByTime(1_500);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.answering = true;
    latest().accept();
    expect(client.state).toBe("open");
    expect(heard).toEqual(["connected", "disconnected", "connected"]);

    // What the dead socket says afterwards is nobody's business.
    dead.onclose?.({ code: 1006 });
    expect(client.state).toBe("open");
  });

  it("comes back from a server that said it was restarting spread over a few seconds", () => {
    const delays: number[] = [];
    for (const roll of [0, 0.5, 0.999]) {
      jest.spyOn(Math, "random").mockReturnValue(roll);
      client.connect();
      latest().accept();
      const before = FakeSocket.all.length;
      latest().drop(1001);
      let waited = 0;
      while (FakeSocket.all.length === before && waited < 10_000) {
        jest.advanceTimersByTime(50);
        waited += 50;
      }
      delays.push(waited);
      client.close();
    }
    // A deploy lets every tab go in the same instant: they must not all return in it.
    expect(delays[0]).toBeGreaterThanOrEqual(1_000);
    expect(delays[2]).toBeLessThanOrEqual(5_050);
    expect((delays[2] ?? 0) - (delays[0] ?? 0)).toBeGreaterThanOrEqual(3_500);
  });

  it("comes straight back when the API is heard from some other way, but not in a burst", () => {
    client.connect();
    latest().accept();
    latest().drop();
    // Away long enough for the waits between attempts to have grown long.
    for (let elapsed = 0; elapsed < 40_000; elapsed += 250) {
      jest.advanceTimersByTime(250);
      const socket = latest();
      if (socket.readyState === FakeSocket.CONNECTING) socket.drop();
    }
    jest.advanceTimersByTime(3_000);
    const before = FakeSocket.all.length;

    // Some request on the page got an answer: the server is back.
    serverAnswered();
    expect(FakeSocket.all).toHaveLength(before + 1);

    // Requests that get through while sockets do not must not become a storm of attempts.
    latest().drop();
    serverAnswered();
    serverAnswered();
    expect(FakeSocket.all).toHaveLength(before + 1);

    jest.advanceTimersByTime(3_100);
    serverAnswered();
    expect(FakeSocket.all.length).toBeGreaterThanOrEqual(before + 2);
    latest().accept();
    expect(client.state).toBe("open");
  });

  it("leaves a tab that was stood down where it is, whatever the API answers", () => {
    client.connect();
    latest().accept();
    latest().drop(4002);
    jest.advanceTimersByTime(10_000);
    serverAnswered();
    expect(FakeSocket.all).toHaveLength(1);
    expect(client.state).toBe("paused");
  });

  it("stops asking once it is closed", () => {
    client.connect();
    const socket = latest();
    socket.accept();
    client.close();
    jest.advanceTimersByTime(120_000);
    expect(pings(socket)).toBe(0);
    expect(FakeSocket.all).toHaveLength(1);
  });
});
