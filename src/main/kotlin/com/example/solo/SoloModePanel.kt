package com.example.solo

import com.example.solo.vcoder.agent.AgentProcessManager
import com.example.solo.vcoder.webview.WebViewPanel
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.JBSplitter
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Container
import java.awt.Dimension
import javax.swing.JPanel
import javax.swing.JLabel
import javax.swing.SwingConstants

class SoloModePanel(
    private val project: Project,
    private val editorsSplitters: Component?,
    private val agentManager: AgentProcessManager?
) : JPanel(BorderLayout()) {
    
    private val splitter: JBSplitter
    private val webViewPanel: WebViewPanel
    private val editorPanel: JPanel
    
    private var originalEditorParent: Container? = null
    private var isEditorMoved = false
    
    init {
        // Use WebViewPanel (BitFunAI page) - toolWindow=null for embedded mode
        webViewPanel = WebViewPanel(project, null, agentManager)
        editorPanel = JPanel(BorderLayout()).apply {
            border = JBUI.Borders.empty()
        }
        
        // Wrap WebViewPanel with header (Exit Solo Mode + Reload buttons)
        val headerPanel = JPanel(java.awt.FlowLayout(java.awt.FlowLayout.LEFT)).apply {
            add(javax.swing.JButton("Reload").apply {
                toolTipText = "重新加载页面（若出现 AI未初始化 可尝试）"
                addActionListener { webViewPanel.reloadPage() }
            })
            add(javax.swing.JButton("Exit Solo Mode").apply {
                addActionListener { ToggleSoloModeAction.toggleSoloMode(project) }
            })
        }
        val leftPanel = JPanel(BorderLayout()).apply {
            add(headerPanel, BorderLayout.NORTH)
            add(webViewPanel.component, BorderLayout.CENTER)
        }
        
        val state = SoloModeState.getInstance()
        splitter = JBSplitter(false, state.splitterProportion).apply {
            firstComponent = leftPanel
            secondComponent = editorPanel
            dividerWidth = 3
            setHonorComponentsMinimumSize(true)
        }
        
        add(splitter, BorderLayout.CENTER)
        
        setupEditor()
    }
    
    private fun setupEditor() {
        if (editorsSplitters != null) {
            originalEditorParent = editorsSplitters.parent
            
            if (originalEditorParent != null) {
                originalEditorParent!!.remove(editorsSplitters)
                isEditorMoved = true
            }
            
            editorPanel.add(editorsSplitters, BorderLayout.CENTER)
            
            println("SoloModePanel: EditorsSplitters moved to solo panel")
        } else {
            showEmptyEditorMessage()
        }
    }
    
    private fun showEmptyEditorMessage() {
        editorPanel.removeAll()
        val emptyLabel = JLabel("No file open - Press Ctrl+Shift+N to open a file").apply {
            horizontalAlignment = SwingConstants.CENTER
        }
        editorPanel.add(emptyLabel, BorderLayout.CENTER)
        editorPanel.revalidate()
        editorPanel.repaint()
    }
    
    fun restoreEditorComponent() {
        if (editorsSplitters != null && isEditorMoved && originalEditorParent != null) {
            editorPanel.remove(editorsSplitters)
            originalEditorParent!!.add(editorsSplitters, BorderLayout.CENTER)
            
            originalEditorParent!!.revalidate()
            originalEditorParent!!.repaint()
            
            println("SoloModePanel: EditorsSplitters restored to original parent")
        }
        
        isEditorMoved = false
    }
    
    fun saveSplitterProportion() {
        val state = SoloModeState.getInstance()
        state.splitterProportion = splitter.proportion
    }
    
    override fun removeNotify() {
        super.removeNotify()
        saveSplitterProportion()
        disposeWebView()
    }

    /**
     * Dispose WebViewPanel and stop the TypeScript backend when exiting Solo mode.
     */
    fun disposeWebView() {
        try {
            Disposer.dispose(webViewPanel)
        } catch (_: Exception) {
            // Already disposed
        }
    }
    
    fun refresh() {
        revalidate()
        repaint()
    }
}
