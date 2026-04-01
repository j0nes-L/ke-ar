import { verifyPassword } from "../../lib/api";
import { isAuthenticated, setAuthenticated, logout } from "../../lib/auth";
import { BASE } from "./state";
import { $, $btn, $input } from "./utils";
import { showDashboard, showLogin } from "./navigation";

export function initAuth() {
  const pwInput = $input("pw-input");
  const pwSubmit = $btn("pw-submit");
  const pwError = $("pw-error");
  const logoutBtn = $btn("btn-logout");
  const logoutBtnDetail = $btn("btn-logout-detail");

  if (isAuthenticated()) {
    showDashboard();
  } else {
    showLogin();
  }

  pwSubmit.addEventListener("click", doLogin);
  pwInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });

  async function doLogin() {
    pwError.classList.add("hidden");
    pwSubmit.disabled = true;
    pwSubmit.textContent = "Checking…";
    try {
      const ok = await verifyPassword(pwInput.value);
      if (ok) {
        setAuthenticated();
        showDashboard();
      } else {
        pwError.textContent = "Invalid password. Please try again.";
        pwError.classList.remove("hidden");
      }
    } catch (err) {
      console.error("Login error:", err);
      pwError.textContent = "Connection error. Please try again.";
      pwError.classList.remove("hidden");
    } finally {
      pwSubmit.disabled = false;
      pwSubmit.textContent = "Unlock";
    }
  }

  function doLogout() {
    logout();
    showLogin();
    pwInput.value = "";
    history.replaceState(null, "", `${BASE}/sessions/`);
  }

  logoutBtn.addEventListener("click", doLogout);
  logoutBtnDetail.addEventListener("click", doLogout);
}

