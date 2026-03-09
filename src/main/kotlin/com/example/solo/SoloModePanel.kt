package com.example.solo

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
    private val editorsSplitters: Component?
) : JPanel(BorderLayout()) {
    
    private val splitter: JBSplitter
    private val customPanel: CustomPanel
    private val editorPanel: JPanel
    
    private var originalEditorParent: Container? = null
    private var isEditorMoved = false
    
    init {
        customPanel = CustomPanel(project)
        editorPanel = JPanel(BorderLayout()).apply {
            border = JBUI.Borders.empty()
        }
        
        val state = SoloModeState.getInstance()
        splitter = JBSplitter(false, state.splitterProportion).apply {
            firstComponent = customPanel
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
    
    fun getCustomPanel(): CustomPanel = customPanel
    
    override fun removeNotify() {
        super.removeNotify()
        saveSplitterProportion()
        customPanel.dispose()
    }
    
    fun refresh() {
        customPanel.refresh()
        revalidate()
        repaint()
    }
}
