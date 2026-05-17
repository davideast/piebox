/**
 * Smoke tests for the browser backend adapter.
 *
 * Uses a minimal in-process VirtualFS that mimics the almostnode `VirtualFS`
 * shape — same method signatures and semantics. We don't depend on the
 * `almostnode` package here because (a) we don't want it as a Node dev
 * dependency, and (b) the contract we're testing is the structural one in
 * AlmostnodeVirtualFsLike.
 */

import { describe, it, expect } from "vitest";
import { createBrowserFs, type AlmostnodeVirtualFsLike } from "./browser-backend.js";

function makeFakeAlmostnodeVfs(): AlmostnodeVirtualFsLike {
  type Node =
    | { type: "file"; data: Uint8Array }
    | { type: "directory"; children: Map<string, Node> };
  const root: Node = { type: "directory", children: new Map() };
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function split(p: string): string[] {
    return p.split("/").filter(Boolean);
  }
  function get(p: string): Node | null {
    let cur: Node = root;
    for (const seg of split(p)) {
      if (cur.type !== "directory") return null;
      const next = cur.children.get(seg);
      if (!next) return null;
      cur = next;
    }
    return cur;
  }
  function mkdirRecursive(p: string) {
    let cur: Node = root;
    for (const seg of split(p)) {
      if (cur.type !== "directory") throw new Error("ENOTDIR");
      let next = cur.children.get(seg);
      if (!next) {
        next = { type: "directory", children: new Map() };
        cur.children.set(seg, next);
      }
      cur = next;
    }
  }
  function parent(p: string): { parent: Node; basename: string } {
    const parts = split(p);
    const basename = parts.pop()!;
    let cur: Node = root;
    for (const seg of parts) {
      if (cur.type !== "directory") throw new Error("ENOTDIR");
      let next = cur.children.get(seg);
      if (!next) {
        next = { type: "directory", children: new Map() };
        cur.children.set(seg, next);
      }
      cur = next;
    }
    return { parent: cur, basename };
  }
  function stat(p: string) {
    const n = get(p);
    if (!n) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const size = n.type === "file" ? n.data.length : 0;
    return {
      isFile: () => n.type === "file",
      isDirectory: () => n.type === "directory",
      isSymbolicLink: () => false,
      size,
      mode: n.type === "directory" ? 0o755 : 0o644,
      mtime: new Date(0),
    };
  }

  const vfs: AlmostnodeVirtualFsLike = {
    existsSync: (p) => get(p) !== null,
    statSync: stat,
    lstatSync: stat,
    accessSync: (p) => {
      if (!get(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    realpathSync: (p) => p,
    readFileSync: ((p: string, encoding?: "utf8" | "utf-8") => {
      const n = get(p);
      if (!n || n.type !== "file") throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      if (encoding === "utf8" || encoding === "utf-8") return dec.decode(n.data);
      return n.data;
    }) as AlmostnodeVirtualFsLike["readFileSync"],
    writeFileSync: (p: string, data: string | Uint8Array) => {
      const { parent: par, basename } = parent(p);
      if (par.type !== "directory") throw new Error("ENOTDIR");
      const bytes = typeof data === "string" ? enc.encode(data) : data;
      par.children.set(basename, { type: "file", data: bytes });
    },
    mkdirSync: (p: string, opts?: { recursive?: boolean }) => {
      if (opts?.recursive) {
        mkdirRecursive(p);
        return;
      }
      const { parent: par, basename } = parent(p);
      if (par.type !== "directory") throw new Error("ENOTDIR");
      if (par.children.has(basename)) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      par.children.set(basename, { type: "directory", children: new Map() });
    },
    readdirSync: (p: string) => {
      const n = get(p);
      if (!n || n.type !== "directory") throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return Array.from(n.children.keys());
    },
    unlinkSync: (p: string) => {
      const { parent: par, basename } = parent(p);
      if (par.type !== "directory" || !par.children.has(basename)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      par.children.delete(basename);
    },
    rmdirSync: (p: string) => {
      const { parent: par, basename } = parent(p);
      if (par.type !== "directory") throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      const n = par.children.get(basename);
      if (!n || n.type !== "directory") throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      par.children.delete(basename);
    },
    renameSync: (a: string, b: string) => {
      const src = get(a);
      if (!src) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      const { parent: srcParent, basename: srcName } = parent(a);
      const { parent: dstParent, basename: dstName } = parent(b);
      (srcParent as { children: Map<string, Node> }).children.delete(srcName);
      (dstParent as { children: Map<string, Node> }).children.set(dstName, src);
    },
    copyFileSync: (a: string, b: string) => {
      const src = get(a);
      if (!src || src.type !== "file") throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      const { parent: dstParent, basename: dstName } = parent(b);
      (dstParent as { children: Map<string, Node> }).children.set(dstName, { type: "file", data: src.data });
    },
  };
  return vfs;
}

describe("createBrowserFs", () => {
  it("normalizes encoding-as-object form for readFileSync", () => {
    const src = makeFakeAlmostnodeVfs();
    const fs = createBrowserFs({ source: src });
    fs.mkdirSync("/work", { recursive: true });
    fs.writeFileSync("/work/a.txt", "hello");

    expect(fs.readFileSync("/work/a.txt", "utf-8")).toBe("hello");
    expect(fs.readFileSync("/work/a.txt", { encoding: "utf-8" })).toBe("hello");
    expect(fs.readFileSync("/work/a.txt")).toBeInstanceOf(Uint8Array);
  });

  it("synthesizes withFileTypes Dirents from readdirSync + statSync", () => {
    const src = makeFakeAlmostnodeVfs();
    const fs = createBrowserFs({ source: src });
    fs.mkdirSync("/w", { recursive: true });
    fs.writeFileSync("/w/file.txt", "x");
    fs.mkdirSync("/w/sub", { recursive: true });

    const dirents = fs.readdirSync("/w", { withFileTypes: true });
    const names = dirents.map((d) => d.name).sort();
    expect(names).toEqual(["file.txt", "sub"]);
    const file = dirents.find((d) => d.name === "file.txt")!;
    const sub = dirents.find((d) => d.name === "sub")!;
    expect(file.isFile()).toBe(true);
    expect(file.isDirectory()).toBe(false);
    expect(sub.isDirectory()).toBe(true);
    expect(sub.isFile()).toBe(false);
  });

  it("implements appendFileSync via read+concat+write", () => {
    const src = makeFakeAlmostnodeVfs();
    const fs = createBrowserFs({ source: src });
    fs.mkdirSync("/w", { recursive: true });
    fs.writeFileSync("/w/a.txt", "one\n");
    fs.appendFileSync!("/w/a.txt", "two\n");
    fs.appendFileSync!("/w/b.txt", "fresh\n"); // creates on missing
    expect(fs.readFileSync("/w/a.txt", "utf-8")).toBe("one\ntwo\n");
    expect(fs.readFileSync("/w/b.txt", "utf-8")).toBe("fresh\n");
  });

  it("throws ENOSYS for symlinkSync and readlinkSync", () => {
    const src = makeFakeAlmostnodeVfs();
    const fs = createBrowserFs({ source: src });
    expect(() => fs.symlinkSync!("/tgt", "/lnk")).toThrow(/ENOSYS/);
    expect(() => fs.readlinkSync!("/lnk")).toThrow(/ENOSYS/);
  });

  it("ignores writeFileSync options arg without error", () => {
    const src = makeFakeAlmostnodeVfs();
    const fs = createBrowserFs({ source: src });
    fs.mkdirSync("/w", { recursive: true });
    fs.writeFileSync("/w/x.txt", "hi", { encoding: "utf-8" });
    expect(fs.readFileSync("/w/x.txt", "utf-8")).toBe("hi");
  });
});
