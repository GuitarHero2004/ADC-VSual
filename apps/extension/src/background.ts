void chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {
    console.error(
      'Could not enable toolbar activation. Open the assistant from the browser side panel.',
    );
  });
