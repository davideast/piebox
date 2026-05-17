/**
 * Structural-compatibility test between piebox-native operation types
 * and the @earendil-works/pi-coding-agent equivalents.
 *
 * Step 2 of the composable-sandbox migration plan (see
 * docs/investigations/G-migration.md) introduces piebox-native type
 * aliases for the seven operation surfaces (Read/Write/Edit/Ls/
 * Grep/Find/Bash). The migration relies on these being STRUCTURALLY
 * IDENTICAL to the SDK types — a value of one is assignable to the
 * other in both directions — so no implementation changes are needed.
 *
 * This file is the contract check: if any SDK update changes one of
 * the interface shapes (a parameter type narrows, an optional method
 * becomes required, etc.), assignability breaks and the test fails
 * at type-check time. Vitest never actually runs the body — `tsc`
 * does the real work.
 */
import { describe, it, expect } from "vitest";
import type {
  ReadOperations as SdkRead,
  WriteOperations as SdkWrite,
  EditOperations as SdkEdit,
  LsOperations as SdkLs,
  GrepOperations as SdkGrep,
  FindOperations as SdkFind,
  BashOperations as SdkBash,
} from "@earendil-works/pi-coding-agent";
import type {
  ReadOperations as PieboxRead,
  WriteOperations as PieboxWrite,
  EditOperations as PieboxEdit,
  LsOperations as PieboxLs,
  GrepOperations as PieboxGrep,
  FindOperations as PieboxFind,
  BashOperations as PieboxBash,
} from "./types.js";

describe("operation types are structurally compatible with the SDK", () => {
  it("ReadOperations <-> SdkReadOperations both directions", () => {
    const piebox = {} as PieboxRead;
    const sdk = {} as SdkRead;
    const fromPieboxToSdk: SdkRead = piebox;
    const fromSdkToPiebox: PieboxRead = sdk;
    expect(fromPieboxToSdk).toBe(piebox);
    expect(fromSdkToPiebox).toBe(sdk);
  });

  it("WriteOperations <-> SdkWriteOperations both directions", () => {
    const piebox = {} as PieboxWrite;
    const sdk = {} as SdkWrite;
    const fromPieboxToSdk: SdkWrite = piebox;
    const fromSdkToPiebox: PieboxWrite = sdk;
    expect(fromPieboxToSdk).toBe(piebox);
    expect(fromSdkToPiebox).toBe(sdk);
  });

  it("EditOperations <-> SdkEditOperations both directions", () => {
    const piebox = {} as PieboxEdit;
    const sdk = {} as SdkEdit;
    const fromPieboxToSdk: SdkEdit = piebox;
    const fromSdkToPiebox: PieboxEdit = sdk;
    expect(fromPieboxToSdk).toBe(piebox);
    expect(fromSdkToPiebox).toBe(sdk);
  });

  it("LsOperations <-> SdkLsOperations both directions", () => {
    const piebox = {} as PieboxLs;
    const sdk = {} as SdkLs;
    const fromPieboxToSdk: SdkLs = piebox;
    const fromSdkToPiebox: PieboxLs = sdk;
    expect(fromPieboxToSdk).toBe(piebox);
    expect(fromSdkToPiebox).toBe(sdk);
  });

  it("GrepOperations <-> SdkGrepOperations both directions", () => {
    const piebox = {} as PieboxGrep;
    const sdk = {} as SdkGrep;
    const fromPieboxToSdk: SdkGrep = piebox;
    const fromSdkToPiebox: PieboxGrep = sdk;
    expect(fromPieboxToSdk).toBe(piebox);
    expect(fromSdkToPiebox).toBe(sdk);
  });

  it("FindOperations <-> SdkFindOperations both directions", () => {
    const piebox = {} as PieboxFind;
    const sdk = {} as SdkFind;
    const fromPieboxToSdk: SdkFind = piebox;
    const fromSdkToPiebox: PieboxFind = sdk;
    expect(fromPieboxToSdk).toBe(piebox);
    expect(fromSdkToPiebox).toBe(sdk);
  });

  it("BashOperations <-> SdkBashOperations both directions", () => {
    const piebox = {} as PieboxBash;
    const sdk = {} as SdkBash;
    const fromPieboxToSdk: SdkBash = piebox;
    const fromSdkToPiebox: PieboxBash = sdk;
    expect(fromPieboxToSdk).toBe(piebox);
    expect(fromSdkToPiebox).toBe(sdk);
  });
});
