package com.example.solo

import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.impl.ActionToolbarImpl
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.*
import com.intellij.openapi.wm.impl.IdeGlassPaneImpl
import com.intellij.openapi.wm.impl.ProjectFrameHelper
import com.intellij.ui.JBSplitter
import com.intellij.util.ui.JBUI
import org.jetbrains.annotations.NotNull
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Container
import java.awt.Dimension
import java.awt.LayoutManager
import java.awt.Window
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent
import java.awt.event.KeyEvent
import java.awt.event.KeyListener
import javax.swing.*
import javax.swing.SwingUtilities

class SoloModeManager(private val project: Project) : Disposable {
    
    private var soloModePanel: SoloModePanel? = null
    private var soloModeRootPanel: JPanel? = null
    
    private val storedToolWindowStates = mutableMapOf<String, Boolean>()
    private var wasStatusBarVisible = true
    
    private var ideFrame: IdeFrame? = null
    private var frame: Window? = null
    private var originalContentPane: Container? = null
    private var soloContentPane: JPanel? = null
    private var rootPane: JRootPane? = null
    
    private var editorComponent: Component? = null
    private var editorParent: Container? = null
    private var editorConstraints: Any? = null
    
    private val storedToolbars = mutableListOf<ActionToolbarImpl>()
    private val originalToolbarComponents = mutableMapOf<ActionToolbarImpl, MutableList<Component>>()
    
    val isSoloModeActive: Boolean
        get() = SoloModeState.getInstance().isSoloModeEnabled
    
    fun enterSoloMode() {
        if (isSoloModeActive) return
        
        ApplicationManager.getApplication().invokeLater {
            doEnterSoloMode()
        }
    }
    
    private fun doEnterSoloMode() {
        ideFrame = WindowManager.getInstance().getIdeFrame(project)
        if (ideFrame == null) {
            println("SoloMode: Cannot find IDE frame")
            return
        }
        
        println("SoloMode: Entering solo mode...")
        
        storeUIStates()
        hideAllUIComponents()
        createSoloModeUI()
        
        SoloModeState.getInstance().isSoloModeEnabled = true
        
        println("SoloMode: Solo mode activated")
    }
    
    fun exitSoloMode() {
        if (!isSoloModeActive) return
        
        ApplicationManager.getApplication().invokeLater {
            doExitSoloMode()
        }
    }
    
    private fun doExitSoloMode() {
        println("SoloMode: Exiting solo mode...")
        
        removeSoloModeUI()
        restoreUIComponents()
        
        SoloModeState.getInstance().isSoloModeEnabled = false
        
        println("SoloMode: Solo mode deactivated")
    }
    
    fun toggleSoloMode() {
        if (isSoloModeActive) {
            exitSoloMode()
        } else {
            enterSoloMode()
        }
    }
    
    private fun storeUIStates() {
        val toolWindowManager = ToolWindowManager.getInstance(project)
        for (id in toolWindowManager.toolWindowIds) {
            val toolWindow = toolWindowManager.getToolWindow(id)
            if (toolWindow != null) {
                storedToolWindowStates[id] = toolWindow.isVisible
            }
        }
        
        val statusBar = ideFrame?.statusBar
        wasStatusBarVisible = statusBar?.component?.isVisible ?: true
        
        storeToolbars()
    }
    
    private fun storeToolbars() {
        storedToolbars.clear()
        originalToolbarComponents.clear()
        
        val ideFrameComponent = ideFrame?.component
        if (ideFrameComponent != null) {
            findAndStoreToolbars(ideFrameComponent)
        }
    }
    
    private fun findAndStoreToolbars(container: Container) {
        for (component in container.components) {
            if (component is ActionToolbarImpl) {
                storedToolbars.add(component)
                val components = mutableListOf<Component>()
                for (i in 0 until component.componentCount) {
                    components.add(component.getComponent(i))
                }
                originalToolbarComponents[component] = components
            }
            
            if (component is Container) {
                findAndStoreToolbars(component)
            }
        }
    }
    
    private fun hideAllUIComponents() {
        val toolWindowManager = ToolWindowManager.getInstance(project)
        for (id in toolWindowManager.toolWindowIds) {
            val toolWindow = toolWindowManager.getToolWindow(id)
            toolWindow?.setAvailable(false, null)
        }
        
        val statusBar = ideFrame?.statusBar
        statusBar?.component?.isVisible = false
        
        hideToolbarButtons()
    }
    
    private fun hideToolbarButtons() {
        for (toolbar in storedToolbars) {
            val components = originalToolbarComponents[toolbar]
            if (components != null) {
                toolbar.removeAll()
                
                for (component in components) {
                    if (isSoloModeToggleButton(component)) {
                        toolbar.add(component)
                    }
                }
                
                toolbar.updateUI()
                toolbar.revalidate()
                toolbar.repaint()
            }
        }
    }
    
    private fun isSoloModeToggleButton(component: Component): Boolean {
        // 方法1：通过Action ID识别
        val actionManager = ActionManager.getInstance()
        val soloModeAction = actionManager.getAction("com.example.solo.ToggleSoloModeAction")
        
        if (soloModeAction != null) {

            // 检查是否为ActionButton或其他Action相关组件
            try {
                // 尝试通过反射获取action属性
                val actionField = component.javaClass.getDeclaredField("myAction")
                actionField.isAccessible = true
                val action = actionField.get(component)
                if (action != null && action == soloModeAction) {
                    return true
                }
            } catch (e: Exception) {
                // 忽略反射异常
            }
        }

        
        return false
    }
    
    private fun findEditorComponent(container: Container): Component? {
        val className = container.javaClass.name
        
        if (className.contains("EditorComponent") || 
            className.contains("EditorImpl") ||
            className.contains("FileEditorManagerImpl") ||
            className.contains("EditorComposite") ||
            className.contains("EditorsSplitters")) {
            return container
        }
        
        for (component in container.components) {
            val compClassName = component.javaClass.name
            if (compClassName.contains("EditorsSplitters") ||
                compClassName.contains("EditorComposite") ||
                compClassName.contains("DesktopEditorsProvider") ||
                compClassName.contains("FileEditorManagerImpl")) {
                return component
            }
            
            if (component is Container) {
                val found = findEditorComponent(component)
                if (found != null) return found
            }
        }
        
        return null
    }
    
    private fun findEditorsSplitters(container: Container): Component? {
        for (component in container.components) {
            val className = component.javaClass.simpleName
            if (className == "EditorsSplitters" || 
                className == "EditorComposite" ||
                className == "DesktopSplitters") {
                return component
            }
            
            if (component is Container) {
                val found = findEditorsSplitters(component)
                if (found != null) return found
            }
        }
        return null
    }
    
    private fun createSoloModeUI() {
        val ideFrameComponent = ideFrame?.component ?: return
        
        frame = SwingUtilities.getWindowAncestor(ideFrameComponent)
        
        rootPane = SwingUtilities.getRootPane(ideFrameComponent)
        if (rootPane == null) {
            println("SoloMode: Cannot find root pane")
            return
        }
        
        originalContentPane = rootPane!!.contentPane
        
        val editorsSplitters = findEditorsSplitters(originalContentPane as Container)
        println("SoloMode: Found editorsSplitters: $editorsSplitters")
        
        if (editorsSplitters != null) {
            editorComponent = editorsSplitters
            editorParent = editorsSplitters.parent
            
            if (editorParent != null && editorParent!!.layout is BorderLayout) {
                val layout = editorParent!!.layout as BorderLayout
                editorConstraints = BorderLayout.CENTER
            }
            
            soloModePanel = SoloModePanel(project, editorsSplitters)
        } else {
            soloModePanel = SoloModePanel(project, null)
        }
        
        soloContentPane = JPanel(BorderLayout()).apply {
            isOpaque = true
            background = UIManager.getColor("Panel.background")
            add(soloModePanel, BorderLayout.CENTER)
        }
        
        rootPane!!.setContentPane(soloContentPane)
        
        frame?.revalidate()
        frame?.repaint()
        
        println("SoloMode: Content pane replaced with solo mode panel")
    }
    
    private fun removeSoloModeUI() {
        if (rootPane == null || originalContentPane == null) return
        
        soloModePanel?.saveSplitterProportion()
        soloModePanel?.restoreEditorComponent()
        soloModePanel = null
        soloContentPane = null
        
        rootPane!!.setContentPane(originalContentPane)
        
        frame?.revalidate()
        frame?.repaint()
        
        originalContentPane = null
        rootPane = null
        frame = null
        editorComponent = null
        editorParent = null
        editorConstraints = null
    }
    
    private fun restoreUIComponents() {
        val toolWindowManager = ToolWindowManager.getInstance(project)
        for ((id, wasVisible) in storedToolWindowStates) {
            val toolWindow = toolWindowManager.getToolWindow(id)
            toolWindow?.setAvailable(true, null)
            if (toolWindow != null && wasVisible) {
                toolWindow.activate(null)
            }
        }
        storedToolWindowStates.clear()
        
        val statusBar = ideFrame?.statusBar
        statusBar?.component?.isVisible = wasStatusBarVisible
        
        restoreToolbarButtons()
    }
    
    private fun restoreToolbarButtons() {
        for (toolbar in storedToolbars) {
            val components = originalToolbarComponents[toolbar]
            if (components != null) {
                toolbar.removeAll()
                for (component in components) {
                    toolbar.add(component)
                }
                toolbar.updateUI()
                toolbar.revalidate()
                toolbar.repaint()
            }
        }
        
        storedToolbars.clear()
        originalToolbarComponents.clear()
    }
    
    override fun dispose() {
        if (isSoloModeActive) {
            doExitSoloMode()
        }
    }
    
    companion object {
        fun getInstance(project: Project): SoloModeManager {
            return project.getService(SoloModeManager::class.java)
        }
    }
}
