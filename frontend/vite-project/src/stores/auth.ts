import { defineStore } from "pinia";
import { ref, computed } from "vue";

const TOKEN_KEY = "codek.token";
const USER_KEY = "codek.username";

export const useAuthStore = defineStore("auth", () => {
  const token = ref(localStorage.getItem(TOKEN_KEY) || "");
  const username = ref(localStorage.getItem(USER_KEY) || "");
  const loading = ref(false);
  const error = ref("");

  const isLoggedIn = computed(() => !!token.value);

  function setAuth(newToken: string, newUsername: string) {
    token.value = newToken;
    username.value = newUsername;
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, newUsername);
  }

  function logout() {
    token.value = "";
    username.value = "";
    error.value = "";
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  return {
    token,
    username,
    loading,
    error,
    isLoggedIn,
    setAuth,
    logout,
  };
});