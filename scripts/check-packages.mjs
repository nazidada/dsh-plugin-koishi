import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const packages = [
  "./packages/dsh-plugin-koishi",
  "./packages/koishi-plugin-dsh-bridge",
];

for (const directory of packages) {
  const { stdout } = await execFileAsync(
    npm,
    ["pack", "--dry-run", "--json", "--ignore-scripts", directory],
    {
      maxBuffer: 1024 * 1024,
    },
  );
  const reports = JSON.parse(stdout);
  const report = reports[0];
  if (!report || !Array.isArray(report.files))
    throw new Error(`${directory}: npm pack returned no file inventory`);
  const names = report.files.map((file) => file.path);
  for (const required of ["package.json", "README.md", "LICENSE"]) {
    if (!names.includes(required))
      throw new Error(`${directory}: package is missing ${required}`);
  }
  if (!names.some((name) => name.startsWith("dist/")))
    throw new Error(`${directory}: package contains no dist files`);
  const forbidden = names.find(
    (name) => name.includes(".test.") || name.startsWith("src/"),
  );
  if (forbidden)
    throw new Error(`${directory}: package unexpectedly contains ${forbidden}`);
}
