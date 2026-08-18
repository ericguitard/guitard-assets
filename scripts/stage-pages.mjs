import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const stageDirectory = path.resolve(root, ".pages");
if (
  path.dirname(stageDirectory) !== root ||
  path.basename(stageDirectory) !== ".pages"
) {
  throw new Error(
    `Refusing to stage outside the repository: ${stageDirectory}`,
  );
}

const manifest = JSON.parse(
  await readFile(path.join(root, "assets.manifest.json"), "utf8"),
);
const files = [
  ...new Set([
    ...manifest.siteFiles,
    ...manifest.resources.map(({ path: relativePath }) => relativePath),
  ]),
];

await rm(stageDirectory, { recursive: true, force: true });
await mkdir(stageDirectory, { recursive: true });

for (const relativePath of files) {
  const source = path.resolve(root, relativePath);
  const destination = path.resolve(stageDirectory, relativePath);
  if (
    !source.startsWith(`${root}${path.sep}`) ||
    !destination.startsWith(`${stageDirectory}${path.sep}`)
  ) {
    throw new Error(`Refusing to stage unsafe path: ${relativePath}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

console.log(`Staged ${files.length} public files in ${stageDirectory}.`);
