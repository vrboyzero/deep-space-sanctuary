export function applyWebConfigLinks(refs, webConfig = {}) {
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
      element.addEventListener("click", (event) => {
        event.preventDefault();
        window.open(resolvedHref, "_blank", "noopener,noreferrer");
      });
    }
  }
}
