import { describe, it, expect } from 'vitest';
import { isMasterViewingOtherSchool, showNotificationsItem, type AccountMenuInput } from './accountMenu';

const u = (o: Partial<AccountMenuInput>): AccountMenuInput => ({
  role: 'admin', isMasterAdmin: false, viewingSchoolId: null, homeSchoolId: 'casa', ...o,
});

describe('showNotificationsItem', () => {
  it('admin e financeiro veem; professor e sem papel não (D9)', () => {
    expect(showNotificationsItem(u({ role: 'admin' }))).toBe(true);
    expect(showNotificationsItem(u({ role: 'financial' }))).toBe(true);
    expect(showNotificationsItem(u({ role: 'teacher' }))).toBe(false);
    expect(showNotificationsItem(u({ role: null }))).toBe(false);
  });
  it('master sem escola visualizada não vê', () => {
    expect(showNotificationsItem(u({ isMasterAdmin: true, viewingSchoolId: null }))).toBe(false);
  });
  it('master na própria escola vê; em outra escola não (D4)', () => {
    expect(showNotificationsItem(u({ isMasterAdmin: true, viewingSchoolId: 'casa' }))).toBe(true);
    expect(showNotificationsItem(u({ isMasterAdmin: true, viewingSchoolId: 'outra' }))).toBe(false);
  });
});

describe('isMasterViewingOtherSchool', () => {
  it('só é true para master com escola visualizada diferente da de casa', () => {
    expect(isMasterViewingOtherSchool(u({ isMasterAdmin: true, viewingSchoolId: 'outra' }))).toBe(true);
    expect(isMasterViewingOtherSchool(u({ isMasterAdmin: true, viewingSchoolId: 'casa' }))).toBe(false);
    expect(isMasterViewingOtherSchool(u({ isMasterAdmin: false, viewingSchoolId: 'outra' }))).toBe(false);
  });
});
