import {
  assertTransition,
  canTransition,
  IllegalTransitionError,
  terminalStates,
} from "./transition";

const table = { A: ["B"], B: ["C", "A"], C: [] } as const;

describe("transition tables", () => {
  it("allows exactly what the table lists", () => {
    expect(canTransition(table, "A", "B")).toBe(true);
    expect(canTransition(table, "B", "A")).toBe(true);
    expect(canTransition(table, "A", "C")).toBe(false);
    expect(canTransition(table, "C", "A")).toBe(false);
  });

  it("names the machine and both states when refusing", () => {
    expect(() => {
      assertTransition("widget", table, "A", "C");
    }).toThrow(IllegalTransitionError);
    expect(() => {
      assertTransition("widget", table, "A", "C");
    }).toThrow("A widget cannot go from A to C.");
    expect(() => {
      assertTransition("widget", table, "A", "B");
    }).not.toThrow();
  });

  it("knows which states are terminal", () => {
    expect(terminalStates(table)).toEqual(["C"]);
  });
});
