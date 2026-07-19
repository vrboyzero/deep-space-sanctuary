export function applyWebConfigLinks(refs = {}, webConfig = {}) {
  let disposed = false;
  const listenerEntries = [];
  const linkMappings = [
    [refs.recommendApiLink, webConfig.recommendApiUrl],
    [refs.aliyunOneKeyLink, webConfig.aliyunOneKeyUrl],
    [refs.officialHomeLink, webConfig.officialHomeUrl],
    [refs.workshopLink, webConfig.workshopUrl],
  ];

  for (const [element, href] of linkMappings) {
    if (element && href) {
      const resolvedHref = String(href).trim();
      if (!resolvedHref) continue;
      element.href = resolvedHref;
      element.target = "_blank";
      element.rel = "noopener noreferrer";
      const handleClick = (event) => {
        if (disposed) return;
        event.preventDefault();
        window.open(resolvedHref, "_blank", "noopener,noreferrer");
      };
      element.addEventListener("click", handleClick);
      listenerEntries.push({ element, handleClick });
    }
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { element, handleClick } of listenerEntries) {
        element.removeEventListener("click", handleClick);
      }
      listenerEntries.length = 0;
    },
    getRuntimeSnapshot() {
      return {
        listenerCount: listenerEntries.length,
        disposed,
      };
    },
  };
}
