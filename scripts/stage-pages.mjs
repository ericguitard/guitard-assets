import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

export async function resolveSafeRegularFile(root, relativePath) {
  const rootRealPath = await realpath(root);
  const source = path.resolve(rootRealPath, relativePath);
  if (!isInside(rootRealPath, source)) {
    throw new Error(`Refusing to stage unsafe path: ${relativePath}`);
  }

  const sourceDetails = await lstat(source);
  if (sourceDetails.isSymbolicLink()) {
    throw new Error(`Refusing to stage symbolic link: ${relativePath}`);
  }
  if (!sourceDetails.isFile()) {
    throw new Error(`Refusing to stage non-file path: ${relativePath}`);
  }

  const sourceRealPath = await realpath(source);
  if (!isInside(rootRealPath, sourceRealPath)) {
    throw new Error(
      `Refusing to stage path outside the repository: ${relativePath}`,
    );
  }

  return sourceRealPath;
}

async function stagePages() {
  const root = await realpath(process.cwd());
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
    const source = await resolveSafeRegularFile(root, relativePath);
    const destination = path.resolve(stageDirectory, relativePath);
    if (!isInside(stageDirectory, destination)) {
      throw new Error(`Refusing to stage unsafe path: ${relativePath}`);
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  const deploymentCommit =
    process.env.DEPLOYMENT_SHA ?? process.env.GITHUB_SHA ?? "local";
  if (
    deploymentCommit !== "local" &&
    !/^[0-9a-f]{40}$/i.test(deploymentCommit)
  ) {
    throw new Error(
      `DEPLOYMENT_SHA must be a full 40-character commit SHA; found ${JSON.stringify(deploymentCommit)}`,
    );
  }

  const deploymentMarker = path.resolve(
    stageDirectory,
    manifest.deploymentMarker.path,
  );
  if (!isInside(stageDirectory, deploymentMarker)) {
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
}

if (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await stagePages();
}
