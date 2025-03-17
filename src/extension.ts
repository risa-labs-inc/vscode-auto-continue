import * as vscode from 'vscode';

// Store UI components
interface UIComponents {
  statusBarItem?: vscode.StatusBarItem;
  panel?: vscode.WebviewPanel;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Auto Continue extension is now active');
  
  const ui: UIComponents = {};
  let isEnabled = vscode.workspace.getConfiguration('autoContinue').get('enabled', true);
  
  // Create status bar item with highest priority (1) to be rightmost
  ui.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1);
  ui.statusBarItem.text = isEnabled ? '$(play-circle) AUTO' : '$(stop-circle) AUTO';
  ui.statusBarItem.tooltip = 'Auto Continue ' + (isEnabled ? 'Enabled' : 'Disabled');
  ui.statusBarItem.command = isEnabled ? 'cursor-auto-continue.disable' : 'cursor-auto-continue.enable';
  ui.statusBarItem.backgroundColor = new vscode.ThemeColor(isEnabled ? 'statusBarItem.warningBackground' : 'statusBarItem.errorBackground');
  ui.statusBarItem.show();
  
  // Register commands
  const enableCommand = vscode.commands.registerCommand('cursor-auto-continue.enable', () => {
    isEnabled = true;
    vscode.workspace.getConfiguration('autoContinue').update('enabled', true, true);
    ui.statusBarItem!.text = '$(play-circle) AUTO';
    ui.statusBarItem!.tooltip = 'Auto Continue Enabled';
    ui.statusBarItem!.command = 'cursor-auto-continue.disable';
    ui.statusBarItem!.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    vscode.window.showInformationMessage('Auto Continue enabled', 'Settings').then(selection => {
      if (selection === 'Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'autoContinue');
      }
    });
    injectScript(context, true);
  });
  
  const disableCommand = vscode.commands.registerCommand('cursor-auto-continue.disable', () => {
    isEnabled = false;
    vscode.workspace.getConfiguration('autoContinue').update('enabled', false, true);
    ui.statusBarItem!.text = '$(stop-circle) AUTO';
    ui.statusBarItem!.tooltip = 'Auto Continue Disabled';
    ui.statusBarItem!.command = 'cursor-auto-continue.enable';
    ui.statusBarItem!.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    vscode.window.showInformationMessage('Auto Continue disabled');
    injectScript(context, false);
  });
  
  // Add config command to open settings
  const configCommand = vscode.commands.registerCommand('cursor-auto-continue.configure', () => {
    vscode.commands.executeCommand('workbench.action.openSettings', 'autoContinue');
  });
  
  // Add commands to context
  context.subscriptions.push(enableCommand, disableCommand, configCommand, ui.statusBarItem);
  
  // Initial script injection
  if (isEnabled) {
    injectScript(context, true);
  }
}

function injectScript(context: vscode.ExtensionContext, enable: boolean) {
  // This is where we'll need to inject our script into the Cursor/VS Code webview
  // Since direct DOM manipulation is not possible through the extension API,
  // we'll need to create a webview panel with our script
  
  try {
    // Create panel if it doesn't exist
    if (!vscode.window.activeTextEditor && enable) {
      vscode.window.showInformationMessage('Open a file first to activate Auto Continue');
      return;
    }
    
    // Generate script content
    const waitTimeMs = vscode.workspace.getConfiguration('autoContinue').get('waitTimeMs', 2000);
    const scriptContent = getAutoContScript(waitTimeMs);
    
    // Find all webview panels (for Cursor's chat interface)
    const webviewPanels = (vscode.window as any).visibleWebviewPanels || [];
    
    if (webviewPanels.length > 0) {
      for (const panel of webviewPanels) {
        if (panel.webview && panel.title.includes('Chat')) {
          injectToWebview(panel.webview, scriptContent, enable);
        }
      }
    } else {
      // Create a hidden webview for script injection if no chat panels exist
      const panel = vscode.window.createWebviewPanel(
        'autoContinue',
        'Auto Continue',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );
      
      injectToWebview(panel.webview, scriptContent, enable);
      
      // Hide panel after injection
      setTimeout(() => {
        panel.dispose();
      }, 1000);
    }
  } catch (error) {
    console.error('Failed to inject script:', error);
    vscode.window.showErrorMessage('Failed to activate Auto Continue. Please try again.');
  }
}

function injectToWebview(webview: vscode.Webview, scriptContent: string, enable: boolean) {
  if (enable) {
    webview.html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
        <title>Auto Continue</title>
      </head>
      <body>
        <div>Auto Continue is active</div>
        <script>
          ${scriptContent}
          
          // Communicate with extension
          const vscode = acquireVsCodeApi();
          
          // Function to notify the extension
          function notifyExtension(message) {
            vscode.postMessage(message);
          }
          
          // Initialize auto-continue
          setTimeout(() => {
            notifyExtension({ command: 'initialized' });
          }, 1000);
        </script>
      </body>
      </html>
    `;
  } else {
    webview.html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline';">
        <title>Auto Continue Disabled</title>
      </head>
      <body>
        <div>Auto Continue is disabled</div>
        <script>
          // Disable script
          if (window.autoContCleanup) {
            window.autoContCleanup();
          }
          
          // Communicate with extension
          const vscode = acquireVsCodeApi();
          vscode.postMessage({ command: 'disabled' });
        </script>
      </body>
      </html>
    `;
  }
}

function getAutoContScript(waitTimeMs: number): string {
  // This is a simplified version of our auto_continue.js script
  // adapted to work within the VS Code extension context
  return `
    (function() {
      // Store cleanup function in global scope
      window.autoContCleanup = function() {
        if (window.__AUTO_CONTINUE_OBSERVER) {
          window.__AUTO_CONTINUE_OBSERVER.disconnect();
          window.__AUTO_CONTINUE_OBSERVER = null;
        }
        if (window.__AUTO_CONTINUE_INTERVAL) {
          clearInterval(window.__AUTO_CONTINUE_INTERVAL);
          window.__AUTO_CONTINUE_INTERVAL = null;
        }
        const indicator = document.getElementById('auto-continue-indicator');
        if (indicator) indicator.remove();
        
        console.log('[Auto-Continue] Disabled');
      };
      
      // Configuration
      const WAIT_TIME_MS = ${waitTimeMs};
      let isWaiting = false;
      const DEBUG = true; // Enable for more detailed logs and direct inspection

      // Debug logger
      function debugLog(...args) {
        if (DEBUG) {
          console.log('[Auto-Continue Debug]', ...args);
        }
      }

      // Direct DOM inspection function (more aggressive for debugging)
      function inspectDOM() {
        if (!DEBUG) return;
        
        // Log all potentially relevant elements for debugging
        debugLog('==== DOM INSPECTION ====');
        
        // Log all markdown sections
        const sections = document.querySelectorAll('.markdown-section, section');
        debugLog('Found', sections.length, 'sections');
        sections.forEach((s, i) => {
          debugLog(\`Section \${i}:\`, {
            text: s.textContent,
            html: s.innerHTML.substring(0, 100) + '...',
            attrs: {
              'data-markdown-raw': s.getAttribute('data-markdown-raw'),
              'data-section-index': s.getAttribute('data-section-index')
            }
          });
        });
        
        // Log resume links
        const links = document.querySelectorAll('.markdown-link, [data-link], span.markdown-link');
        debugLog('Found', links.length, 'potential links');
        links.forEach((l, i) => {
          debugLog(\`Link \${i}:\`, {
            text: l.textContent,
            dataLink: l.getAttribute('data-link'),
            class: l.className
          });
        });
        
        // Log anysphere containers
        const containers = document.querySelectorAll('.anysphere-markdown-container-root');
        debugLog('Found', containers.length, 'anysphere containers');
        containers.forEach((c, i) => {
          debugLog(\`Container \${i}:\`, {
            text: c.textContent.substring(0, 100) + '...',
            html: c.innerHTML.substring(0, 100) + '...'
          });
        });
      }
      
      // Get VS Code theme colors
      function getVSCodeColors() {
        try {
          // Try to get VS Code theme colors from the computed styles of a VS Code element
          const element = document.querySelector('.monaco-editor') || document.body;
          if (!element) return null;
          
          const styles = window.getComputedStyle(element);
          const backgroundColor = document.body && window.getComputedStyle(document.body).backgroundColor;
          
          // Check if we're in a dark theme
          const isDark = backgroundColor && isColorDark(backgroundColor);
          
          return {
            buttonBackground: isDark ? 'rgba(76, 175, 80, 0.8)' : 'rgba(0, 120, 0, 0.8)',
            buttonHoverBackground: isDark ? 'rgba(82, 190, 86, 0.9)' : 'rgba(0, 140, 0, 0.9)',
            buttonText: isDark ? 'white' : 'white',
            waitBackground: isDark ? 'rgba(66, 139, 202, 0.9)' : 'rgba(83, 164, 224, 0.9)', // Sky blue
            notificationBackground: isDark ? 'rgba(30, 30, 30, 0.95)' : 'rgba(245, 245, 245, 0.95)',
            notificationText: isDark ? 'rgb(240, 240, 240)' : 'rgb(30, 30, 30)',
            notificationBorder: isDark ? 'rgba(80, 80, 80, 0.5)' : 'rgba(200, 200, 200, 0.5)',
            successText: isDark ? 'rgb(128, 255, 128)' : 'rgb(0, 100, 0)',
            errorText: isDark ? 'rgb(255, 128, 128)' : 'rgb(200, 0, 0)'
          };
        } catch (e) {
          console.error('[Auto-Continue] Error getting VS Code colors:', e);
          return null;
        }
      }
      
      // Helper to determine if a color is dark
      function isColorDark(color) {
        // Extract RGB components
        const rgb = color.match(/\\d+/g);
        if (!rgb || rgb.length < 3) return true; // Default to dark
        
        // Calculate luminance (rough approximation)
        const luminance = (0.299 * parseInt(rgb[0]) + 0.587 * parseInt(rgb[1]) + 0.114 * parseInt(rgb[2])) / 255;
        return luminance < 0.5;
      }
      
      // Get theme colors
      const themeColors = getVSCodeColors() || {
        buttonBackground: 'rgba(76, 175, 80, 0.8)',
        buttonHoverBackground: 'rgba(82, 190, 86, 0.9)',
        buttonText: 'white',
        waitBackground: 'rgba(66, 139, 202, 0.9)', // Sky blue
        notificationBackground: 'rgba(40, 40, 40, 0.95)',
        notificationText: 'white',
        notificationBorder: 'rgba(80, 80, 80, 0.5)',
        successText: 'rgb(128, 255, 128)',
        errorText: 'rgb(255, 128, 128)'
      };
      
      // Helper to create styled element
      function createIndicator() {
        const wrapper = document.createElement('div');
        wrapper.id = 'auto-continue-indicator';
        
        const inner = document.createElement('div');
        Object.assign(inner.style, {
          position: 'fixed',
          bottom: '45px',
          right: '10px',
          padding: '7px 14px',
          borderRadius: '4px',
          backgroundColor: themeColors.buttonBackground,
          color: themeColors.buttonText,
          fontSize: '13px',
          fontWeight: 'bold',
          zIndex: '2147483647',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", sans-serif',
          userSelect: 'none',
          transition: 'background-color 0.2s ease, transform 0.1s ease'
        });
        
        inner.textContent = 'AUTO';
        wrapper.appendChild(inner);
        
        try {
          document.body.appendChild(wrapper);
          console.log('[Auto-Continue] Indicator added');
          
          // Add hover effect
          inner.addEventListener('mouseover', () => {
            inner.style.backgroundColor = themeColors.buttonHoverBackground;
            inner.style.transform = 'scale(1.05)';
          });
          
          inner.addEventListener('mouseout', () => {
            inner.style.backgroundColor = themeColors.buttonBackground;
            inner.style.transform = 'scale(1)';
          });
          
          // Show a modal-style notification on click instead of side panel
          inner.addEventListener('click', () => {
            const modal = document.createElement('div');
            Object.assign(modal.style, {
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              backgroundColor: themeColors.notificationBackground,
              color: themeColors.notificationText,
              padding: '20px',
              borderRadius: '6px',
              zIndex: '2147483647',
              boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
              maxWidth: '300px',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", sans-serif',
              border: '1px solid ' + themeColors.notificationBorder,
              animation: 'autoContinueModalFadeIn 0.2s ease-out'
            });
            
            const title = document.createElement('div');
            title.textContent = 'Auto Continue';
            Object.assign(title.style, {
              fontWeight: 'bold',
              fontSize: '16px',
              marginBottom: '10px',
              borderBottom: '1px solid ' + themeColors.notificationBorder,
              paddingBottom: '8px'
            });
            
            const content = document.createElement('div');
            content.textContent = 'Auto Continue is active and monitoring for tool call limits. It will automatically continue the conversation when tool call limits are reached.';
            Object.assign(content.style, {
              marginBottom: '15px',
              lineHeight: '1.4'
            });
            
            const closeButton = document.createElement('button');
            closeButton.textContent = 'Close';
            Object.assign(closeButton.style, {
              padding: '6px 12px',
              border: 'none',
              borderRadius: '4px',
              backgroundColor: themeColors.buttonBackground,
              color: themeColors.buttonText,
              cursor: 'pointer',
              float: 'right'
            });
            
            closeButton.addEventListener('click', () => {
              modal.style.opacity = '0';
              modal.style.transform = 'translate(-50%, -50%) scale(0.95)';
              modal.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
              setTimeout(() => modal.remove(), 200);
            });
            
            // Add animation keyframes for modal
            if (!document.getElementById('auto-continue-modal-styles')) {
              const style = document.createElement('style');
              style.id = 'auto-continue-modal-styles';
              style.textContent = "@keyframes autoContinueModalFadeIn { from { opacity: 0; transform: translate(-50%, -50%) scale(0.95); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }";
              document.head.appendChild(style);
            }
            
            // Close modal when clicking outside
            modal.addEventListener('click', (e) => {
              if (e.target === modal) {
                closeButton.click();
              }
            });
            
            // Add elements to modal
            modal.appendChild(title);
            modal.appendChild(content);
            modal.appendChild(closeButton);
            document.body.appendChild(modal);
            
            // Auto-close after 5 seconds
            setTimeout(() => {
              if (document.body.contains(modal)) {
                closeButton.click();
              }
            }, 5000);
          });
        } catch (e) {
          console.error('[Auto-Continue] Failed to add indicator:', e);
        }
        
        return wrapper;
      }
      
      // Show notification 
      function showNotification(message, isError = false) {
        const notification = document.createElement('div');
        
        Object.assign(notification.style, {
          position: 'fixed',
          bottom: '100px',
          right: '10px',
          backgroundColor: themeColors.notificationBackground,
          color: isError ? themeColors.errorText : themeColors.notificationText,
          padding: '10px 14px',
          borderRadius: '4px',
          zIndex: '2147483647',
          boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
          fontSize: '13px',
          maxWidth: '300px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", sans-serif',
          lineHeight: '1.4',
          border: '1px solid ' + themeColors.notificationBorder,
          animation: 'autoContinueNotificationFadeIn 0.2s ease-out'
        });
        
        // Add animation keyframes
        if (!document.getElementById('auto-continue-styles')) {
          const style = document.createElement('style');
          style.id = 'auto-continue-styles';
          style.textContent = "@keyframes autoContinueNotificationFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }";
          document.head.appendChild(style);
        }
        
        // Create message container
        const messageDiv = document.createElement('div');
        if (isError) {
          const icon = document.createElement('span');
          icon.textContent = '⚠️ ';
          icon.style.marginRight = '6px';
          messageDiv.appendChild(icon);
        } else if (message.includes('success')) {
          const icon = document.createElement('span');
          icon.textContent = '✅ ';
          icon.style.marginRight = '6px';
          messageDiv.appendChild(icon);
        }
        
        messageDiv.appendChild(document.createTextNode(message));
        notification.appendChild(messageDiv);
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
          notification.style.opacity = '0';
          notification.style.transform = 'translateY(10px)';
          notification.style.transition = 'opacity 0.2s ease-out, transform 0.2s ease-out';
          
          setTimeout(() => notification.remove(), 200);
        }, 5000);
      }
      
      // DIRECT RESUME FUNCTION - Force resume by directly accessing elements
      function forceResume() {
        debugLog('Attempting force resume...');
        let clicked = false;
        
        // Most aggressive method - try all possible resume link selectors
        const allSelectors = [
          '.markdown-link[data-link*="resumeCurrentChat"]',
          '.markdown-link[data-link*="composer.resumeCurrentChat"]',
          '[data-link*="resumeCurrentChat"]',
          '[data-link*="composer.resumeCurrentChat"]',
          'a[href*="resumeCurrentChat"]',
          'span.markdown-link',
          'span[data-link*="resumeCurrentChat"]',
          'span[data-link*="composer.resumeCurrentChat"]'
        ];
        
        // Create a custom event for more reliable clicks
        const clickEvent = new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true
        });
        
        // Try all selectors
        for (const selector of allSelectors) {
          if (clicked) break;
          
          try {
            const elements = document.querySelectorAll(selector);
            debugLog(\`Found \${elements.length} elements matching \${selector}\`);
            
            for (const el of elements) {
              if (clicked) break;
              
              try {
                debugLog('Attempting to click:', el);
                
                // Try multiple click methods
                try { el.click(); } catch (e) { debugLog('Native click failed:', e); }
                try { el.dispatchEvent(clickEvent); } catch (e) { debugLog('Event dispatch failed:', e); }
                
                // Try to trigger resume via data attributes if present
                if (el.hasAttribute('data-link')) {
                  const dataLink = el.getAttribute('data-link');
                  if (dataLink && dataLink.includes('resumeCurrentChat')) {
                    try {
                      // Create and dispatch a custom event to trigger the resume command
                      const customEvent = new CustomEvent('cursorCommand', {
                        detail: { command: 'composer.resumeCurrentChat' },
                        bubbles: true
                      });
                      el.dispatchEvent(customEvent);
                      debugLog('Dispatched custom resume event');
                    } catch (e) {
                      debugLog('Custom event failed:', e);
                    }
                  }
                }
                
                // Check if text content contains 'resume'
                if (el.textContent.toLowerCase().includes('resume')) {
                  clicked = true;
                  debugLog('Successfully clicked resume element');
                  break;
                }
              } catch (e) {
                debugLog('Click attempt failed for element:', e);
              }
            }
          } catch (e) {
            debugLog('Selector error:', e);
          }
        }
        
        // Fallback method: find all elements with "resume" text
        if (!clicked) {
          debugLog('Fallback: searching for elements with resume text');
          document.querySelectorAll('*').forEach(el => {
            if (clicked) return;
            
            try {
              if (el.textContent && 
                  el.textContent.toLowerCase().includes('resume') && 
                  el.offsetWidth > 0 && 
                  el.offsetHeight > 0) {
                debugLog('Found element with resume text:', el);
                try { el.click(); } catch (e) { debugLog('Native click failed:', e); }
                try { el.dispatchEvent(clickEvent); } catch (e) { debugLog('Event dispatch failed:', e); }
                clicked = true;
              }
            } catch (e) {
              // Ignore errors for this broad search
            }
          });
        }
        
        // Fallback method: input field
        if (!clicked) {
          debugLog('Fallback: trying input field method');
          const inputField = document.querySelector('textarea') || document.querySelector('[role="textbox"]');
          const submitButton = document.querySelector('button[type="submit"]') || 
                             document.querySelector('button:not([disabled])');
          
          if (inputField && submitButton) {
            try {
              inputField.value = "continue";
              inputField.dispatchEvent(new Event('input', {bubbles: true}));
              setTimeout(() => {
                submitButton.click();
                clicked = true;
                debugLog('Used input field method');
              }, 200);
            } catch (e) {
              debugLog('Input method failed:', e);
            }
          }
        }
        
        // Final fallback: try to trigger command directly
        if (!clicked) {
          debugLog('Final fallback: trying to trigger command directly');
          try {
            // Create a custom event on document to try triggering the resume command
            const commandEvent = new CustomEvent('vscode.command', {
              detail: { command: 'composer.resumeCurrentChat' },
              bubbles: true
            });
            document.dispatchEvent(commandEvent);
            
            // Try additional command patterns
            ['resumeCurrentChat', 'composer.resumeCurrentChat', 'cursor.resumeChat'].forEach(cmd => {
              const cmdEvent = new CustomEvent('vscode.command', {
                detail: { command: cmd },
                bubbles: true
              });
              document.dispatchEvent(cmdEvent);
            });
          } catch (e) {
            debugLog('Command event failed:', e);
          }
        }
        
        return clicked;
      }
      
      // Handle tool call limit
      function handleToolCallLimit() {
        if (isWaiting) return;
        
        console.log('[Auto-Continue] Tool call limit detected');
        debugLog('Tool call limit detected');
        isWaiting = true;
        
        // Update indicator
        const indicator = document.querySelector('#auto-continue-indicator div');
        if (indicator) {
          indicator.style.backgroundColor = themeColors.waitBackground;
          indicator.textContent = 'WAIT...';
        }
        
        showNotification('Tool call limit detected. Auto-continuing in ' + (WAIT_TIME_MS/1000) + ' seconds...');
        
        // Run DOM inspection in debug mode
        if (DEBUG) {
          inspectDOM();
        }
        
        setTimeout(() => {
          const clicked = forceResume();
          
          // Reset indicator
          const indicator = document.querySelector('#auto-continue-indicator div');
          if (indicator) {
            indicator.style.backgroundColor = themeColors.buttonBackground;
            indicator.textContent = 'AUTO';
          }
          
          // Show result
          if (clicked) {
            showNotification('Conversation auto-continued successfully');
          } else {
            showNotification('Failed to auto-continue. Please click resume manually.', true);
          }
          
          isWaiting = false;
        }, WAIT_TIME_MS);
      }
      
      // Setup observer
      function setupObserver() {
        // Check if observer already exists
        if (window.__AUTO_CONTINUE_OBSERVER) {
          window.__AUTO_CONTINUE_OBSERVER.disconnect();
        }
        
        const container = document.querySelector('.chat-container') || 
                          document.querySelector('[class*="chat"]') || 
                          document.querySelector('main') || 
                          document.body;
        
        window.__AUTO_CONTINUE_OBSERVER = new MutationObserver(mutations => {
          if (isWaiting) return;
          
          // Check if there are any significant changes that might indicate a tool call limit
          let shouldCheck = false;
          
          for (const mutation of mutations) {
            // If nodes were added, it might be our message
            if (mutation.addedNodes && mutation.addedNodes.length > 0) {
              shouldCheck = true;
              break;
            }
            
            // If attributes changed on relevant elements, check
            if (mutation.type === 'attributes' && 
                (mutation.target.classList.contains('markdown-section') || 
                 mutation.target.classList.contains('markdown-link') ||
                 mutation.target.classList.contains('anysphere-markdown-container-root'))) {
              shouldCheck = true;
              break;
            }
          }
          
          if (shouldCheck) {
            // Check all the various patterns that might indicate a tool call limit
            checkForToolCallLimit();
          }
        });
        
        window.__AUTO_CONTINUE_OBSERVER.observe(container, { 
          childList: true, 
          subtree: true, 
          attributes: true,
          characterData: true 
        });
        
        console.log('[Auto-Continue] Observer setup complete');
      }
      
      // Comprehensive check for tool call limit
      function checkForToolCallLimit() {
        debugLog('Checking for tool call limit indicators');
        
        // 1. Check for specific text patterns anywhere in the document
        const toolCallIndicators = [
          'default stop the agent',
          'stop the agent after',
          'after 25 tool calls',
          'tool calls',
          'resume the conversation'
        ];
        
        // Scan entire document for these phrases
        const documentText = document.body.textContent;
        if (documentText) {
          for (const indicator of toolCallIndicators) {
            if (documentText.includes(indicator)) {
              debugLog(\`Found tool call indicator text: \${indicator}\`);
              handleToolCallLimit();
              return;
            }
          }
        }
        
        // 2. Look for specific elements with resume functionality
        const resumeElement = document.querySelector('.markdown-link[data-link*="resumeCurrentChat"], span.markdown-link');
        if (resumeElement) {
          debugLog('Found resume element:', resumeElement);
          handleToolCallLimit();
          return;
        }
        
        // 3. Check for any elements with resumeCurrentChat in data-link
        const resumeLinks = document.querySelectorAll('[data-link*="resumeCurrentChat"], [data-link*="composer.resumeCurrentChat"]');
        if (resumeLinks.length > 0) {
          debugLog('Found resume links:', resumeLinks.length);
          handleToolCallLimit();
          return;
        }
        
        // 4. Look for specific HTML structure shown in user's example
        const anysphere = document.querySelector('.anysphere-markdown-container-root');
        if (anysphere && anysphere.textContent.includes('tool calls')) {
          debugLog('Found anysphere container with tool calls text');
          handleToolCallLimit();
          return;
        }
        
        // 5. Check for content in markdown sections
        const sections = document.querySelectorAll('.markdown-section, section');
        for (const section of sections) {
          const text = section.textContent || '';
          const rawAttr = section.getAttribute('data-markdown-raw') || '';
          
          for (const indicator of toolCallIndicators) {
            if (text.includes(indicator) || rawAttr.includes(indicator)) {
              debugLog(\`Found tool call indicator in section: \${indicator}\`);
              handleToolCallLimit();
              return;
            }
          }
        }
      }
      
      // Run on interval to catch any issues with initial detection
      function runPeriodicChecks() {
        if (!isWaiting) {
          checkForToolCallLimit();
        }
      }
      
      // Create indicator
      createIndicator();
      
      // Setup persistence
      window.__AUTO_CONTINUE_INTERVAL = setInterval(() => {
        if (!document.getElementById('auto-continue-indicator')) {
          createIndicator();
        }
        
        // Try to find the chat container and set up observer if it exists
        const chatContainer = document.querySelector('.chat-container') || 
                             document.querySelector('[class*="chat"]') ||
                             document.querySelector('.anysphere-markdown-container-root') ||
                             document.querySelector('main');
        
        if (chatContainer && !window.__AUTO_CONTINUE_OBSERVER) {
          setupObserver();
        }
        
        // Run periodic checks for tool call limits
        runPeriodicChecks();
      }, 2000);
      
      // Initial setup
      setupObserver();
      
      // Check for existing tool call limits immediately
      setTimeout(checkForToolCallLimit, 500);
      
      // Run another check after a short delay to catch any missed elements
      setTimeout(checkForToolCallLimit, 1500);
      
      // Also run a check if user interacts with the page
      document.addEventListener('click', () => {
        setTimeout(checkForToolCallLimit, 500);
      });
      
      console.log('[Auto-Continue] Extension activated with enhanced detection');
    })();
  `;
}

export function deactivate() {
  console.log('Auto Continue extension deactivated');
} 