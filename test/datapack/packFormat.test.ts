import { test } from 'node:test';
import assert from 'node:assert/strict';
import versions from '../../resources/data/versions.json';
import type { McVersion } from '../../src/core/versions';
import {
  buildOverlayEntries,
  buildPackSection,
  describeVersions,
  overlayName,
  parseFormatValue,
  rangeForVersions,
  readPackRange,
  validatePackMcmeta,
} from '../../src/features/datapack/packFormat';

const table = versions as McVersion[];

test('parseFormatValue', () => {
  assert.deepEqual(parseFormatValue(48), [48, 0]);
  assert.deepEqual(parseFormatValue([94]), [94, 0]);
  assert.deepEqual(parseFormatValue([94, 1]), [94, 1]);
  assert.equal(parseFormatValue('48'), undefined);
  assert.equal(parseFormatValue([1, 2, 3]), undefined);
});

test('single old version → pack_format only', () => {
  const r = rangeForVersions('1.21.1', '1.21.1', 'data', table)!;
  assert.deepEqual(buildPackSection(r, 'data', { description: 'x' }), { description: 'x', pack_format: 48 });
});

test('old range → pack_format + supported_formats', () => {
  const r = rangeForVersions('1.21', '1.21.4', 'data', table)!;
  assert.deepEqual(buildPackSection(r, 'data'), { pack_format: 48, supported_formats: [48, 61] });
});

test('new-only range → min/max format (minor kept), no supported_formats', () => {
  const r = rangeForVersions('1.21.11', '26.3', 'data', table)!;
  assert.deepEqual(buildPackSection(r, 'data'), { pack_format: 94, min_format: [94, 1], max_format: 121 });
  const rr = rangeForVersions('26.3', '26.3', 'resource', table)!;
  assert.deepEqual(buildPackSection(rr, 'resource'), { pack_format: 97, min_format: [97, 1], max_format: [97, 1] });
});

test('range spanning both eras → all four fields', () => {
  const r = rangeForVersions('1.21', '26.1', 'data', table)!;
  assert.deepEqual(buildPackSection(r, 'data', { description: 'd' }), {
    description: 'd',
    pack_format: 48,
    supported_formats: [48, 101],
    min_format: 48,
    max_format: [101, 1],
  });
  // reversed arguments are normalized
  assert.deepEqual(rangeForVersions('26.1', '1.21', 'data', table), r);
});

test('describeVersions groups contiguous releases', () => {
  assert.equal(describeVersions({ min: [48, 0], max: [48, 0] }, 'data', table), '1.21 – 1.21.1');
  assert.equal(describeVersions({ min: [57, 0], max: [61, 0] }, 'data', table), '1.21.2 – 1.21.4');
  assert.equal(describeVersions({ min: [101, 1], max: [101, 1] }, 'data', table), '26.1 – 26.1.2');
  assert.equal(describeVersions({ min: [125, 0], max: [125, 0] }, 'data', table), '26.4-snapshot-5');
});

test('readPackRange handles all eras', () => {
  assert.deepEqual(readPackRange({ pack_format: 48 }), { min: [48, 0], max: [48, 0] });
  assert.deepEqual(readPackRange({ pack_format: 48, supported_formats: { min_inclusive: 41, max_inclusive: 61 } }), { min: [41, 0], max: [61, 0] });
  assert.deepEqual(readPackRange({ min_format: [94, 1], max_format: 121 }), { min: [94, 1], max: [121, 0] });
});

test('validatePackMcmeta', () => {
  const codes = (j: unknown, v: string, f: [number, number]) => validatePackMcmeta(j, 'data', v, f).map((p) => p.code);
  assert.deepEqual(codes({ pack: { description: '', pack_format: 48 } }, '1.21.1', [48, 0]), []);
  assert.ok(codes({ pack: { description: '', pack_format: 48 } }, '26.3', [121, 0]).includes('missingMinMax'));
  assert.ok(codes({ pack: { description: '', pack_format: 48 } }, '26.3', [121, 0]).includes('targetNotSupported'));
  assert.ok(codes({ pack: { description: '', min_format: 94, max_format: 121, supported_formats: [94, 121] } }, '26.3', [121, 0]).includes('supportedFormatsNotAllowed'));
  assert.ok(codes({ pack: { description: '', min_format: 48, max_format: 121 } }, '26.3', [121, 0]).includes('missingSupportedFormats'));
  assert.deepEqual(codes({ pack: { description: '', pack_format: 48, supported_formats: [48, 121], min_format: 48, max_format: 121 } }, '26.3', [121, 0]), []);
  // 1.21.11 is 94.1: max_format 94 means [94, 0] which does not include it
  assert.ok(codes({ pack: { description: '', min_format: 94, max_format: 94 } }, '1.21.11', [94, 1]).includes('targetNotSupported'));
  assert.ok(codes({}, '26.3', [121, 0]).includes('missingPack'));
});

test('overlay entries', () => {
  const entries = buildOverlayEntries(
    [
      { directory: 'old', range: { min: [48, 0], max: [61, 0] } },
      { directory: 'new', range: { min: [94, 1], max: [121, 0] } },
    ],
    'data',
  );
  assert.deepEqual(entries, [
    { directory: 'old', formats: [48, 61], min_format: 48, max_format: 61 },
    { directory: 'new', formats: [94, 121], min_format: [94, 1], max_format: 121 },
  ]);
  const onlyNew = buildOverlayEntries([{ directory: 'n', range: { min: [94, 1], max: [121, 0] } }], 'data');
  assert.deepEqual(onlyNew, [{ directory: 'n', min_format: [94, 1], max_format: 121 }]);
  const oldPack = buildOverlayEntries([{ directory: 'o', range: { min: [48, 0], max: [61, 0] } }], 'data', { min: [41, 0], max: [61, 0] });
  assert.deepEqual(oldPack, [{ directory: 'o', formats: [48, 61] }]);
  assert.equal(overlayName('1.21.4', '1.21.4'), 'overlay_1_21_4');
  assert.equal(overlayName('26.1', '26.3'), 'overlay_26_1_to_26_3');
});
