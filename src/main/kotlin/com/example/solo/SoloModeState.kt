package com.example.solo

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.util.xmlb.XmlSerializerUtil

@State(
    name = "SoloModeState",
    storages = [Storage("soloMode.xml")]
)
class SoloModeState : PersistentStateComponent<SoloModeState> {
    
    var isSoloModeEnabled: Boolean = false
    var customPanelWidth: Int = 300
    var splitterProportion: Float = 0.3f

    override fun getState(): SoloModeState {
        return this
    }

    override fun loadState(state: SoloModeState) {
        XmlSerializerUtil.copyBean(state, this)
    }

    companion object {
        fun getInstance(): SoloModeState {
            return ApplicationManager.getApplication().getService(SoloModeState::class.java)
        }
    }
}
