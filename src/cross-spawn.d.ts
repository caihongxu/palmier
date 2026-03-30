declare module "cross-spawn" {
  import type { ChildProcess, SpawnOptions } from "child_process";
  function spawn(command: string, args?: string[], options?: SpawnOptions): ChildProcess;
  export default spawn;
}
