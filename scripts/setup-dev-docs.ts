import { access } from "node:fs/promises";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const checkoutPath = join(repositoryRoot, "dev-docs");
const remoteUrl = "https://github.com/RostrumAI/rostrum-dev-docs.git";

let checkoutExists = true;
try {
    await access(checkoutPath);
} catch {
    checkoutExists = false;
}

if (checkoutExists) {
    const probe = Bun.spawn(["git", "-C", checkoutPath, "rev-parse", "--is-inside-work-tree"], {
        stdout: "pipe",
        stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
        probe.exited,
        new Response(probe.stdout).text(),
        new Response(probe.stderr).text(),
    ]);
    if (exitCode !== 0 || stdout.trim() !== "true") {
        throw new Error(
            `dev-docs exists but is not a Git checkout: ${stderr.trim() || checkoutPath}`,
        );
    }
    console.log(`Development docs already available at ${checkoutPath}`);
} else {
    const clone = Bun.spawn(["git", "clone", remoteUrl, checkoutPath], {
        cwd: repositoryRoot,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });
    const exitCode = await clone.exited;
    if (exitCode !== 0) {
        throw new Error(`git clone failed with exit code ${exitCode}`);
    }
}
