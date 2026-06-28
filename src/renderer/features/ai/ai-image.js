// ============================================================
// AI Image Generation Panel — DevilBrowser
// ============================================================
(function () {
  'use strict';

  const panel = document.getElementById('ai-image-panel');
  const promptInput = document.getElementById('ai-image-prompt');
  const btnGenerate = document.getElementById('ai-image-generate');
  const btnClose = document.getElementById('ai-image-close');
  const btnToggle = document.getElementById('btn-ai-image');
  const imageDisplay = document.getElementById('ai-image-display');
  const btnDownload = document.getElementById('ai-image-download');
  const modelSelect = document.getElementById('ai-image-model-select');
  const statusEl = document.getElementById('ai-image-status');

  let lastImageUrl = null;
  let isGenerating = false;

  window.aiImage = {
    async open() {
      const token = await window.electronAPI.aiGetToken();
      if (!token) {
        if (window.aiAuth) window.aiAuth.showModal();
        return;
      }
      if (!panel) return;

      if (window.closeAllSidePanels) {
        window.closeAllSidePanels('ai-image-panel');
      }

      panel.classList.add('open');
      updateLayout();
      await loadImageModels();
    },
    close() {
      if (!panel) return;
      panel.classList.remove('open');
      updateLayout();
    }
  };

  function updateLayout() {
    if (window.updateLayout) {
      window.updateLayout();
    }
  }

  async function imageUrlToBase64(url) {
    const res = await window.electronAPI.aiFetchImageBase64(url);
    if (res.error) throw new Error(res.error);
    return `data:${res.mimeType};base64,${res.base64}`;
  }

  async function loadImageModels() {
    if (!modelSelect) return;
    try {
      const res = await window.electronAPI.aiGetModels();
      if (res && res.models) {
        // Filter to image-capable or Gemini 2.5+ models
        const imageModels = res.models.filter(m =>
          m.includes('image') || 
          m.includes('imagen') || 
          m.includes('gemini-2.5') || 
          m.includes('gemini-3')
        );
        
        // Ensure gemini-2.5-flash-image is included as primary
        if (!imageModels.includes('gemini-2.5-flash-image')) {
          imageModels.unshift('gemini-2.5-flash-image');
        }
        
        // Ensure gemini-2.5-flash is included
        if (!imageModels.includes('gemini-2.5-flash')) {
          imageModels.push('gemini-2.5-flash');
        }
        
        // Prioritize gemini-2.5-flash-image as the default selection
        const defaultModel = 'gemini-2.5-flash-image';
        
        modelSelect.innerHTML = '';
        imageModels.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m;
          opt.textContent = m;
          if (m === defaultModel) {
            opt.selected = true;
          }
          modelSelect.appendChild(opt);
        });
      }
    } catch (e) { }
  }

  function setStatus(msg, type = 'info') {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = `ai-image-status ${type}`;
  }

  async function generateImage() {
    if (isGenerating || !promptInput) return;
    const prompt = promptInput.value.trim();
    if (!prompt) { setStatus('Please enter a prompt.', 'error'); return; }

    isGenerating = true;
    if (btnGenerate) { btnGenerate.disabled = true; btnGenerate.textContent = 'Generating...'; }
    if (imageDisplay) imageDisplay.innerHTML = '<div class="ai-image-spinner">✨ Creating image...</div>';
    if (btnDownload) btnDownload.style.display = 'none';
    setStatus('Generating image — this may take a few seconds...', 'info');

    try {
      const model = modelSelect ? modelSelect.value : 'gemini-2.5-flash-image';
      
      const systemInstruction = 
        "You are an AI image generator. When the user requests an image, you must generate a highly detailed prompt for generating that image. " +
        "You must respond ONLY with a JSON object calling the tool 'dalle.text2im', with your detailed prompt as input. " +
        "Example response format:\n" +
        "{\n" +
        "  \"action\": \"dalle.text2im\",\n" +
        "  \"action_input\": \"{ \\\"prompt\\\": \\\"A beautiful red rose...\\\" }\",\n" +
        "  \"thought\": \"Generating the image...\"\n" +
        "}\n" +
        "Do not include any other text, markdown formatting, or explanation. Return only valid JSON.";

      const res = await window.electronAPI.aiGenerate({
        prompt,
        model,
        systemInstruction,
        maxOutputTokens: 1024
      });

      if (res && res.images && res.images.length > 0) {
        const imgData = res.images[0];
        const dataUrl = `data:${imgData.mimeType};base64,${imgData.data}`;
        lastImageUrl = dataUrl;

        if (imageDisplay) {
          imageDisplay.innerHTML = '';
          const img = document.createElement('img');
          img.src = dataUrl;
          img.className = 'ai-generated-image';
          img.alt = prompt;
          imageDisplay.appendChild(img);
        }
        if (btnDownload) btnDownload.style.display = 'block';
        setStatus('Image generated successfully!', 'success');
        window.aiQuota && window.aiQuota.refresh();
      } else if (res && res.text) {
        // Model returned text instead of image - parse and process it
        setStatus('Processing image response...', 'info');
        try {
          let imageUrl = null;
          let finalPrompt = prompt;

          // 1. Try to parse as JSON tool call (dalle.text2im)
          try {
            let jsonText = res.text.trim();
            const matchJson = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (matchJson) {
              jsonText = matchJson[1];
            }
            const parsed = JSON.parse(jsonText);
            if (parsed && (parsed.action === 'dalle.text2im' || parsed.action === 'image-generation')) {
              let input = parsed.action_input;
              if (typeof input === 'string') {
                try { input = JSON.parse(input); } catch(e) {}
              }
              if (input && input.prompt) {
                finalPrompt = input.prompt;
              } else if (typeof input === 'string') {
                finalPrompt = input;
              }
              imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=1024&height=1024&nologo=true`;
            }
          } catch (e) {}

          // 2. Try to extract markdown image link if present
          if (!imageUrl) {
            const matchMarkdown = res.text.match(/!\[.*?\]\((https?:\/\/.*?)\)/);
            if (matchMarkdown) {
              imageUrl = matchMarkdown[1];
            }
          }

          // 3. Fallback: treat the entire text response as the prompt for image generation,
          // or if the text is short, use the text itself.
          if (!imageUrl) {
            const cleanText = res.text.replace(/[*#`_\-]/g, '').trim();
            if (cleanText.length > 5 && cleanText.length < 500) {
              finalPrompt = cleanText;
            }
            imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=1024&height=1024&nologo=true`;
          }

          // Fetch the imageUrl and convert to base64
          const dataUrl = await imageUrlToBase64(imageUrl);
          lastImageUrl = dataUrl;

          if (imageDisplay) {
            imageDisplay.innerHTML = '';
            const img = document.createElement('img');
            img.src = dataUrl;
            img.className = 'ai-generated-image';
            img.alt = finalPrompt;
            imageDisplay.appendChild(img);
          }
          if (btnDownload) btnDownload.style.display = 'block';
          setStatus('Image generated successfully!', 'success');
          window.aiQuota && window.aiQuota.refresh();
        } catch (err) {
          setStatus('⚠️ Image rendering failed: ' + err.message, 'error');
          if (imageDisplay) imageDisplay.innerHTML = `<div class="ai-image-text-result">${res.text}</div>`;
        }
      } else {
        setStatus('No image was generated. Try a different prompt.', 'error');
        if (imageDisplay) imageDisplay.innerHTML = '';
      }
    } catch (e) {
      setStatus('⚠️ Generation failed: ' + e.message, 'error');
      if (imageDisplay) imageDisplay.innerHTML = '';
    } finally {
      isGenerating = false;
      if (btnGenerate) { btnGenerate.disabled = false; btnGenerate.textContent = '✨ Generate'; }
    }
  }

  if (btnGenerate) btnGenerate.addEventListener('click', generateImage);
  if (promptInput) promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generateImage(); }
  });
  if (btnClose) btnClose.addEventListener('click', () => window.aiImage.close());
  if (btnToggle) btnToggle.addEventListener('click', () => {
    panel && panel.classList.contains('open') ? window.aiImage.close() : window.aiImage.open();
  });

  if (btnDownload) {
    btnDownload.addEventListener('click', async () => {
      if (!lastImageUrl) return;
      const parts = lastImageUrl.split(',');
      if (parts.length < 2) return;
      const base64Data = parts[1];
      const match = parts[0].match(/data:(image\/[^;]+);base64/);
      const mimeType = match ? match[1] : 'image/png';
      const ext = mimeType.split('/')[1] || 'png';

      setStatus('Saving image...', 'info');
      try {
        const res = await window.electronAPI.saveImage({
          base64Data,
          defaultFilename: `ai-generated-image.${ext}`
        });
        if (res.success) {
          let filename = res.filePath.replace(/\\/g, '/').split('/').pop();
          setStatus(`Image saved as ${filename}!`, 'success');
          // Log to downloads panel
          if (window.addCompletedDownload) {
            window.addCompletedDownload({ fileName: filename, filePath: res.filePath });
          }
        } else if (res.error !== 'Canceled') {
          setStatus(`⚠️ Failed to save: ${res.error}`, 'error');
        } else {
          setStatus('Save canceled.', 'info');
        }
      } catch (err) {
        setStatus(`⚠️ Save failed: ${err.message}`, 'error');
      }
    });
  }

})();
