// Adapted from spec_vcoder HarmonyOSSettings
package com.example.solo.vcoder.settings;

import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.components.PersistentStateComponent;
import com.intellij.openapi.components.State;
import com.intellij.openapi.components.Storage;
import com.intellij.util.xmlb.XmlSerializerUtil;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

@State(
    name = "VcoderSettings",
    storages = @Storage("solo-vcoder-settings.xml")
)
public class VcoderSettings implements PersistentStateComponent<VcoderSettings> {

    public String modelProvider = "openai";
    public String modelName = "glm-4-7-251222";
    public String apiKey = "";
    public String apiBaseUrl = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
    public String devecoHomePath = "";
    /** Optional: override backend path when auto-detection fails (e.g. for OpenHarmony project) */
    public String backendPathOverride = "";
    public String defaultAgentMode = "HarmonyOSDev";
    public boolean autoStartAgent = true;
    public int devServerPort = 1422;
    public int agentPort = 0;

    public static VcoderSettings getInstance() {
        return ApplicationManager.getApplication().getService(VcoderSettings.class);
    }

    @Override
    public @Nullable VcoderSettings getState() {
        return this;
    }

    @Override
    public void loadState(@NotNull VcoderSettings state) {
        XmlSerializerUtil.copyBean(state, this);
    }
}
