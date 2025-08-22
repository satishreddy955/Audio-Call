export const TOKEN_KEY = 'webaudio_token';
export function saveToken(token) { localStorage.setItem(TOKEN_KEY, token); }
export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function removeToken() { localStorage.removeItem(TOKEN_KEY); }
export function authHeader() { return { Authorization: `Bearer ${getToken()}` }; }
