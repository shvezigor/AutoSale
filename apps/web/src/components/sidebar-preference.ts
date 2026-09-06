export const SIDEBAR_STORAGE_KEY = 'autosale.sidebar';

export const SIDEBAR_PREFERENCE_SCRIPT = `try{const value=localStorage.getItem('${SIDEBAR_STORAGE_KEY}');document.documentElement.dataset.sidebarState=value==='collapsed'?'collapsed':'expanded'}catch{document.documentElement.dataset.sidebarState='expanded'}`;
