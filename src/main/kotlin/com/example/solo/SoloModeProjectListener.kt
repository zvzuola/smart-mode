package com.example.solo

import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManagerListener
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState

class SoloModeProjectListener : ProjectManagerListener {
    
    override fun projectOpened(project: Project) {
        val state = SoloModeState.getInstance()
        
        if (state.isSoloModeEnabled) {
            ApplicationManager.getApplication().invokeLater({
                val manager = SoloModeManager.getInstance(project)
                manager.enterSoloMode()
            }, ModalityState.defaultModalityState())
        }
    }
    
    override fun projectClosing(project: Project) {
        val manager = SoloModeManager.getInstance(project)
        if (manager.isSoloModeActive) {
            manager.exitSoloMode()
        }
    }
}
