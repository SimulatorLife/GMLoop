import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function decodeXml(value) {
  return String(value ?? '')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function parseAttributes(fragment) {
  const attributes = {};
  for (const match of String(fragment).matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/gu)) {
    attributes[match[1]] = decodeXml(match[2]);
  }
  return attributes;
}

function normalizeFile(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\.\//u, '');
}

function findingFingerprint(file, attributes) {
  return [
    normalizeFile(file),
    String(attributes.severity ?? '').toLowerCase(),
    String(attributes.source ?? ''),
    String(attributes.message ?? ''),
  ].join('\0');
}

export function parseLintErrors(xml) {
  const source = String(xml ?? '');
  if (!/<checkstyle\b/iu.test(source) || !/<\/checkstyle>/iu.test(source)) {
    throw new Error('Checkstyle document is incomplete.');
  }

  const findings = [];
  for (const fileMatch of source.matchAll(/<file\b([^>]*)>([\s\S]*?)<\/file>/giu)) {
    const fileAttributes = parseAttributes(fileMatch[1]);
    const file = normalizeFile(fileAttributes.name);
    if (!file) throw new Error('Checkstyle file entry is missing a name.');

    for (const errorMatch of fileMatch[2].matchAll(/<error\b([^>]*)\/?\s*>/giu)) {
      const attributes = parseAttributes(errorMatch[1]);
      const severity = String(attributes.severity ?? '').toLowerCase();
      if (severity !== 'error') continue;
      findings.push({
        file,
        severity,
        source: String(attributes.source ?? ''),
        message: String(attributes.message ?? ''),
        fingerprint: findingFingerprint(file, attributes),
      });
    }
  }
  return findings;
}

function toCounts(findings) {
  const counts = new Map();
  for (const finding of findings) {
    counts.set(finding.fingerprint, (counts.get(finding.fingerprint) ?? 0) + 1);
  }
  return counts;
}

export function compareLintErrors(baseXml, targetXml) {
  const base = parseLintErrors(baseXml);
  const target = parseLintErrors(targetXml);
  const remaining = toCounts(base);
  const newFindings = [];

  for (const finding of target) {
    const count = remaining.get(finding.fingerprint) ?? 0;
    if (count > 0) {
      if (count === 1) remaining.delete(finding.fingerprint);
      else remaining.set(finding.fingerprint, count - 1);
      continue;
    }
    newFindings.push(finding);
  }

  return {
    eligible: newFindings.length === 0,
    baseErrors: base.length,
    targetErrors: target.length,
    newErrors: newFindings.length,
    newFindings,
  };
}

function writeGithubOutputs(outputPath, result) {
  if (!outputPath) return;
  fs.appendFileSync(
    outputPath,
    [
      `eligible=${result.eligible ? 'true' : 'false'}`,
      `base_errors=${result.baseErrors}`,
      `target_errors=${result.targetErrors}`,
      `new_errors=${result.newErrors}`,
    ].join('\n') + '\n',
    'utf8',
  );
}

function selfTest() {
  const wrap = (body) => `<?xml version="1.0"?><checkstyle version="8.0">${body}</checkstyle>`;
  const finding = ({ file = 'src/a.ts', line = 1, rule = 'eslint.rule', message = 'bad' } = {}) =>
    `<file name="${file}"><error line="${line}" column="1" severity="error" message="${message}" source="${rule}" /></file>`;

  const moved = compareLintErrors(
    wrap(finding({ line: 2 })),
    wrap(finding({ line: 200 })),
  );
  assert.equal(moved.eligible, true);
  assert.equal(moved.newErrors, 0);

  const replaced = compareLintErrors(
    wrap(finding({ rule: 'eslint.old', message: 'old problem' })),
    wrap(finding({ rule: 'eslint.new', message: 'new problem' })),
  );
  assert.equal(replaced.eligible, false);
  assert.equal(replaced.newErrors, 1);

  const duplicate = compareLintErrors(
    wrap(finding()),
    wrap(`${finding()}${finding()}`),
  );
  assert.equal(duplicate.eligible, false);
  assert.equal(duplicate.newErrors, 1);

  console.log('check-lint-regression self-test passed');
}

function parseArgs(argv) {
  const args = { selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--self-test') args.selfTest = true;
    else if (arg === '--base') args.base = argv[++index];
    else if (arg === '--target') args.target = argv[++index];
    else if (arg === '--github-output') args.githubOutput = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

if (import.meta.url === new URL(`file://${path.resolve(process.argv[1] ?? '')}`).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.selfTest) {
      selfTest();
    } else {
      if (!args.base || !args.target) throw new Error('--base and --target are required.');
      const result = compareLintErrors(
        fs.readFileSync(args.base, 'utf8'),
        fs.readFileSync(args.target, 'utf8'),
      );
      writeGithubOutputs(args.githubOutput, result);
      console.log(`Lint regression check: base=${result.baseErrors}, target=${result.targetErrors}, new=${result.newErrors}.`);
      if (result.newErrors > 0) {
        for (const finding of result.newFindings.slice(0, 20)) {
          console.error(`NEW ${finding.file}: ${finding.source || 'eslint'}: ${finding.message}`);
        }
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 2;
  }
}
