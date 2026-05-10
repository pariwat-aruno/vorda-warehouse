import { CONFIG } from './config.js';

export const state = {
  lineUserId: null,
  profile: null, // { userId, displayName, pictureUrl }
};

/** init LIFF + getProfile */
export async function initAuth(liffId) {
  if (CONFIG.DEV_MOCK_LIFF) {
    const mock = CONFIG.DEV_MOCK_PROFILE || {};
    state.lineUserId = mock.userId || 'Udevtest0000000000000000000000001';
    state.profile = {
      userId: state.lineUserId,
      displayName: mock.displayName || '(dev mock)',
      pictureUrl: '',
    };
    return;
  }
  if (typeof liff === 'undefined') throw new Error('LIFF SDK ไม่โหลด');
  await liff.init({ liffId });
  if (!liff.isLoggedIn()) {
    liff.login();
    return; // จะ redirect แล้วโหลดใหม่
  }
  state.profile = await liff.getProfile();
  state.lineUserId = state.profile.userId;
}
