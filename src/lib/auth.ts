const AUTH_KEY = "ke-ar-auth";

export function setAuthenticated(): void {
  localStorage.setItem(AUTH_KEY, "true");
}

export function isAuthenticated(): boolean {
  return localStorage.getItem(AUTH_KEY) === "true";
}

export function logout(): void {
  localStorage.removeItem(AUTH_KEY);
}

