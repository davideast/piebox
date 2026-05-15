/**
 * BashOperations backed by just-bash, using @platformatic/vfs as the
 * filesystem foundation through an IFileSystem adapter.
 */

import type { Bash, ExecOptions as JustBashExecOptions } from "just-bash";
import type { BashOperations } from "@earendil-works/pi-coding-agent";

export function createBashOperations(bash: Bash): BashOperations {
  return {
    async exec(command, cwd, options) {
      try {
        const execOptions: JustBashExecOptions = {
          cwd,
          signal: options.signal,
        };

        const result = await bash.exec(command, execOptions);
        const output = result.stdout + result.stderr;

        if (output) {
          options.onData(Buffer.from(output));
        }

        return { exitCode: result.exitCode };
      } catch (err: any) {
        const errMsg = `just-bash error: ${err.message}`;
        options.onData(Buffer.from(errMsg + "\n"));
        return { exitCode: 1 };
      }
    },
  };
}
