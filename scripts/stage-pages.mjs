import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

const deploymentCommit =
  process.env.DEPLOYMENT_SHA ?? process.env.GITHUB_SHA ?? "local";
if (deploymentCommit !== "local" && !/^[0-9a-f]{40}$/i.test(deploymentCommit)) {
  throw new Error(
    `DEPLOYMENT_SHA must be a full 40-character commit SHA; found ${JSON.stringify(deploymentCommit)}`,
  );
}

const deploymentMarker = path.resolve(
  stageDirectory,
  manifest.deploymentMarker.path,
);
if (!deploymentMarker.startsWith(`${stageDirectory}${path.sep}`)) {
  throw new Error(
    `Refusing to stage unsafe deployment marker: ${manifest.deploymentMarker.path}`,
  );
}
await mkdir(path.dirname(deploymentMarker), { recursive: true });
await writeFile(
  deploymentMarker,
  `${JSON.stringify(
    {
      version: 1,
      commit: deploymentCommit,
      deployedAt: new Date().toISOString(),
      source: "github-pages-actions",
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  `Staged ${files.length + 1} public files in ${stageDirectory}, including ${manifest.deploymentMarker.path}.`,
);
