import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ANDROID_PACKAGE,
  PERMISSION_STEPS,
  getPermissionStep,
  summarizePermissions,
} from '../app/core/permissionPlan.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = readFileSync(
  path.join(projectRoot, 'android/app/src/main/AndroidManifest.xml'),
  'utf8',
);
const appConfig = readFileSync(path.join(projectRoot, 'app.json'), 'utf8');
const gradle = readFileSync(path.join(projectRoot, 'android/app/build.gradle'), 'utf8');

test('permission plan has unique keys and one of the two supported kinds', () => {
  const keys = PERMISSION_STEPS.map((step) => step.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicated permission key');

  for (const step of PERMISSION_STEPS) {
    assert.ok(step.label.length > 0, `missing label for ${step.key}`);
    assert.ok(step.description.length > 0, `missing description for ${step.key}`);
    assert.ok(
      step.kind === 'runtime' || step.kind === 'settings',
      `invalid kind for ${step.key}: ${step.kind}`,
    );

    if (step.kind === 'runtime') {
      assert.ok(
        Array.isArray(step.runtimePermissions) && step.runtimePermissions.length > 0,
        `runtime step ${step.key} needs at least one permission`,
      );
      assert.equal(step.settingsAction, undefined, `runtime step ${step.key} has settingsAction`);
    } else {
      assert.equal(
        step.runtimePermissions,
        undefined,
        `settings step ${step.key} must not request runtime permissions`,
      );
      assert.ok(
        typeof step.settingsAction === 'string' && step.settingsAction.length > 0,
        `settings step ${step.key} needs a settingsAction`,
      );
    }
  }
});

test('every runtime permission is declared in the Android manifest', () => {
  for (const step of PERMISSION_STEPS) {
    for (const permission of step.runtimePermissions ?? []) {
      assert.match(permission, /^android\.permission\./, `odd permission name: ${permission}`);
      assert.ok(
        manifest.includes(`android:name="${permission}"`),
        `${permission} (${step.key}) is not declared in the AndroidManifest`,
      );
    }
  }
});

test('microphone is the only essential permission and is requested first', () => {
  const essential = PERMISSION_STEPS.filter((step) => step.essential).map((step) => step.key);
  assert.deepEqual(essential, ['microphone']);
  assert.equal(PERMISSION_STEPS[0].key, 'microphone');
});

test('the app package matches the package registered in the Android build', () => {
  assert.equal(ANDROID_PACKAGE, 'com.jefferson.nexusassistente');
  assert.ok(appConfig.includes(`"${ANDROID_PACKAGE}"`));
  assert.ok(gradle.includes(ANDROID_PACKAGE));
});

test('getPermissionStep resolves known keys only', () => {
  assert.equal(getPermissionStep('overlay')?.kind, 'settings');
  assert.equal(getPermissionStep('microphone')?.essential, true);
  assert.equal(getPermissionStep('nao-existe'), undefined);
});

test('summarizePermissions counts granted steps and missing essentials', () => {
  const empty = summarizePermissions();
  assert.equal(empty.granted, 0);
  assert.equal(empty.total, PERMISSION_STEPS.length);
  assert.equal(empty.essentialOk, false);
  assert.deepEqual(empty.missingEssential, ['microphone']);

  const full = summarizePermissions(
    Object.fromEntries(PERMISSION_STEPS.map((step) => [step.key, true])),
  );
  assert.equal(full.granted, PERMISSION_STEPS.length);
  assert.equal(full.essentialOk, true);
  assert.deepEqual(full.missingEssential, []);

  const partial = summarizePermissions({ microphone: true, contacts: true, overlay: false });
  assert.equal(partial.granted, 2);
  assert.equal(partial.essentialOk, true);
});
