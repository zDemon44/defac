const registering = location.pathname === "/register";
document.title = `${registering ? "Crear cuenta" : "Ingresar"} · Defac`;
document
  .querySelector(registering ? "#registerTab" : "#loginTab")
  .setAttribute("aria-current", "page");
document.querySelector("#authTitle").textContent = registering
  ? "Crea tu cuenta"
  : "Inicia sesión";
document.querySelector("#authDescription").textContent = registering
  ? "Organiza tus empresas en un espacio privado."
  : "Accede a tus empresas y comprobantes.";
for (const id of ["nameField", "confirmField", "registerNotice"])
  document.getElementById(id).hidden = !registering;
document.getElementById("name").required = registering;
document.getElementById("passwordConfirmation").required = registering;
document.getElementById("password").autocomplete = registering
  ? "new-password"
  : "current-password";
const submit = document.getElementById("authSubmit");
submit.textContent = registering ? "Crear cuenta" : "Entrar";
document
  .getElementById("authForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const error = document.getElementById("authError");
    error.hidden = true;
    if (registering && data.password !== data.passwordConfirmation) {
      error.textContent = "Las contraseñas no coinciden.";
      error.hidden = false;
      return;
    }
    submit.disabled = true;
    submit.textContent = registering ? "Creando cuenta…" : "Ingresando…";
    try {
      const response = await fetch(
        `/api/auth/${registering ? "register" : "login"}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-Defac-Request": "1",
          },
          body: JSON.stringify(data),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "No fue posible ingresar.");
      form.reset();
      location.replace("/");
    } catch (err) {
      error.textContent = err.message || "No se pudo conectar al servidor.";
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = registering ? "Crear cuenta" : "Entrar";
    }
  });
