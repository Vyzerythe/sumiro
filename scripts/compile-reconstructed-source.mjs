import { dirname, join } from 'node:path';
import ts from 'typescript';

export function compileReconstructedSource(projectRoot, outputDirectory) {
  const configPath = join(projectRoot, 'tsconfig.json');
  const diagnosticsHost = {
    getCurrentDirectory: () => projectRoot,
    getCanonicalFileName: filename => filename,
    getNewLine: () => '\n',
  };
  const failOnDiagnostics = diagnostics => {
    if (diagnostics.length) throw Error(ts.formatDiagnostics(diagnostics, diagnosticsHost));
  };

  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) failOnDiagnostics([config.error]);
  const settings = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath), {
    rootDir: join(projectRoot, 'src'),
    outDir: outputDirectory,
    noEmit: false,
    noEmitOnError: true,
    sourceMap: true,
    inlineSources: true,
  });
  failOnDiagnostics(settings.errors);

  const program = ts.createProgram(settings.fileNames, settings.options);
  const files = new Map();
  const emission = program.emit(undefined, (path, contents) => {
    files.set(path, contents);
  });
  failOnDiagnostics(emission.diagnostics);
  if (emission.emitSkipped) throw Error('TypeScript compilation produced no development build');
  return files;
}
