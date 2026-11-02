import { describe, expect, it } from 'vitest';
import { kubectlApply } from './k8sSchema';
import { kubectlTable } from './k8sMessages';
import {
  applyDeployment,
  deploymentYaml,
  endpointSliceTable,
  isDone,
  matched,
  missingPair,
  parseLabel,
  selects,
  serviceYaml,
  withLabel,
  withoutLabel,
  type LmPod,
} from './labelMatchmaker';

const pods: LmPod[] = [
  { name: 'tray-1', labels: { app: 'shop', tier: 'web' } },
  { name: 'tray-2', labels: { app: 'shop' } },
  { name: 'tray-3', labels: { app: 'api' } },
];

describe('labels and selectors', () => {
  it('a selector needs every pair', () => {
    expect(selects({ app: 'shop' }, { app: 'shop', tier: 'web' })).toBe(true);
    expect(selects({ app: 'shop', tier: 'web' }, { app: 'shop' })).toBe(false);
    expect(selects({}, { app: 'shop' })).toBe(false);
    expect(matched({ app: 'shop' }, pods)).toEqual(['tray-1', 'tray-2']);
  });
  it('one value per key', () => {
    expect(withLabel({ app: 'shop' }, 'app=web')).toEqual({ app: 'web' });
    expect(withLabel({ app: 'shop' }, 'tier=web')).toEqual({ app: 'shop', tier: 'web' });
    expect(withoutLabel({ app: 'shop', tier: 'web' }, 'tier')).toEqual({ app: 'shop' });
    expect(parseLabel('not a label')).toBeNull();
  });
  it('says what is missing', () => {
    expect(missingPair({ app: 'shop', tier: 'web' }, { app: 'shop' })).toEqual({
      key: 'tier',
      want: 'web',
      has: undefined,
    });
  });
  it('checks the task', () => {
    expect(isDone({ type: 'select', pods: ['tray-1', 'tray-2'] }, { app: 'shop' }, pods)).toBe(
      true,
    );
    expect(isDone({ type: 'select', pods: ['tray-1'] }, { app: 'shop' }, pods)).toBe(false);
    expect(isDone({ type: 'template' }, { app: 'shop' }, [], { app: 'shop', tier: 'web' })).toBe(
      true,
    );
  });
});

describe('kubectl output', () => {
  it('lays tables out like kubectl (tabwriter, padding 3)', () => {
    // Real kubectl 1.37.2 output from our test cluster.
    expect(
      kubectlTable(
        ['NAME', 'ADDRESSTYPE', 'PORTS', 'ENDPOINTS', 'AGE'],
        [
          ['lonely-9hnd2', 'IPv4', '<unset>', '<unset>', '25s'],
          ['shop-6mr2h', 'IPv4', '80', '10.244.1.5,10.244.2.2,10.244.2.3 + 2 more...', '25s'],
        ],
      ),
    ).toEqual([
      'NAME           ADDRESSTYPE   PORTS     ENDPOINTS                                      AGE',
      'lonely-9hnd2   IPv4          <unset>   <unset>                                        25s',
      'shop-6mr2h     IPv4          80        10.244.1.5,10.244.2.2,10.244.2.3 + 2 more...   25s',
    ]);
  });
  it('shows <unset> when nothing matches', () => {
    const t = endpointSliceTable('shop', pods, { app: 'menu' }, 80);
    expect(t[1]).toMatch(
      /^shop-[bcdfghjklmnpqrstvwxz2456789]{5}\s+IPv4\s+<unset>\s+<unset>\s+12s$/,
    );
  });
  it('lists matching pod IPs', () => {
    const t = endpointSliceTable('shop', pods, { app: 'shop' }, 80);
    expect(t[1]).toMatch(/IPv4\s+80\s+10\.244\.\d+\.\d+,10\.244\.\d+\.\d+\s+12s$/);
  });
  it('the Deployment error is the real one', () => {
    expect(applyDeployment('shop', { app: 'shop' }, { app: 'web' }).text).toBe(
      'The Deployment "shop" is invalid: spec.template.metadata.labels: Invalid value: {"app":"web"}: `selector` does not match template `labels`',
    );
    // Same as the full checker gives for the same YAML.
    const y = deploymentYaml('shop', { app: 'shop' }, { app: 'web' });
    expect(kubectlApply(y, 'shop.yaml').lines[0]!.text).toBe(
      applyDeployment('shop', { app: 'shop' }, { app: 'web' }).text,
    );
    expect(
      kubectlApply(
        deploymentYaml('shop', { app: 'shop' }, { app: 'shop', tier: 'web' }),
        'shop.yaml',
      ).ok,
    ).toBe(true);
  });
  it('the Service YAML applies', () => {
    expect(
      kubectlApply(serviceYaml('shop', { app: 'shop', tier: 'web' }, 80, 8080), 'svc.yaml')
        .lines[0]!.text,
    ).toBe('service/shop created');
  });
});
