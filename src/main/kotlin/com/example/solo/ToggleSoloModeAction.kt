package com.example.solo

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.Project

class ToggleSoloModeAction : AnAction() {
    
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val manager = SoloModeManager.getInstance(project)
        manager.toggleSoloMode()
    }
    
    override fun update(e: AnActionEvent) {
        val project = e.project
        if (project != null) {
            val state = SoloModeState.getInstance()
            if (state.isSoloModeEnabled) {
                e.presentation.text = "Exit Solo Mode"
                e.presentation.description = "Return to standard IDE mode"
            } else {
                e.presentation.text = "Enter Solo Mode"
                e.presentation.description = "Switch to focused editing mode"
            }
        }
        e.presentation.isEnabled = project != null
    }
    
    companion object {
        fun toggleSoloMode(project: Project) {
            val manager = SoloModeManager.getInstance(project)
            manager.toggleSoloMode()
        }
    }
}
