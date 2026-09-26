/** 위자드 화면은 앱 헤더·하단 내비 없이 자체 헤더와 하단 액션 바를 쓴다. */
export function isWizardPath(pathname: string): boolean {
  return pathname === "/app/automations/new" || /^\/app\/automations\/[^/]+\/edit$/.test(pathname);
}
