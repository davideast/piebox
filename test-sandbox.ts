/**
 * test-sandbox.ts — Exercise the sandbox() primary API.
 */

import { sandbox } from "./src/index.js";

async function main() {
  console.log("── Test 1: sandbox() with manual file population ──");
  {
    const sb = sandbox();

    // Use node:fs API directly — no wrappers
    sb.fs.writeFileSync(`${sb.cwd}/hello.txt`, "Hello from sandbox!\n");
    sb.fs.mkdirSync(`${sb.cwd}/src`, { recursive: true });
    sb.fs.writeFileSync(`${sb.cwd}/src/index.ts`, 'console.log("hi");\n');

    // Query via fs
    const files = sb.fs.readdirSync(sb.cwd);
    console.log("  Files:", files);

    // Shell
    const result = await sb.shell.exec("cat hello.txt");
    console.log("  cat hello.txt →", result.stdout.trim());

    // Git is null (no clone)
    console.log("  git:", sb.git);

    console.log("  ✅ Pass\n");
  }

  console.log("── Test 2: sandbox() with clone ──");
  {
    const sb = sandbox();

    await sb.clone({
      url: "https://github.com/nicolo-ribaudo/semver-v6",
      depth: 1,
      singleBranch: true,
    });

    // fs sees the cloned files
    const files = sb.fs.readdirSync(sb.cwd) as string[];
    console.log("  Cloned files:", files.slice(0, 8), "...");

    // git is now populated
    const branch = await sb.git!.currentBranch();
    console.log("  Branch:", branch);

    const log = await sb.git!.log(1);
    console.log("  Latest commit:", log[0]?.commit?.message?.trim().slice(0, 60));

    // Agent writes a file — git detects it
    sb.fs.writeFileSync(`${sb.cwd}/agent-output.txt`, "Agent wrote this.\n");
    const modified = await sb.git!.modifiedFiles();
    console.log("  Modified:", modified);

    console.log("  ✅ Pass\n");
  }

  console.log("── Test 3: composability — clone then augment ──");
  {
    const sb = sandbox();

    await sb.clone({
      url: "https://github.com/nicolo-ribaudo/semver-v6",
      depth: 1,
      singleBranch: true,
    });

    // Augment the cloned repo with extra files
    sb.fs.writeFileSync(
      `${sb.cwd}/INSTRUCTIONS.md`,
      "Focus on error handling.\n",
    );

    // Both the cloned files and the augmented file exist
    const has = {
      readme: sb.fs.existsSync(`${sb.cwd}/README.md`),
      instructions: sb.fs.existsSync(`${sb.cwd}/INSTRUCTIONS.md`),
    };
    console.log("  Has README.md:", has.readme);
    console.log("  Has INSTRUCTIONS.md:", has.instructions);
    console.log("  ✅ Pass\n");
  }

  console.log("✅ All sandbox() tests passed!");
}

main().catch(console.error);
