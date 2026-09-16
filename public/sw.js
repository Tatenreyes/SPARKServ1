// SPARKServ service worker — handles push notifications so they arrive even
// when the app tab is closed, and routes a click on the notification back
// into the app at the relevant page.

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "SPARKServ", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "SPARKServ", {
      body: payload.body || "",
      icon: "/favicon.ico",
      data: { link: payload.link || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(link) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
    })
  );
});
