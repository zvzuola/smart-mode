package com.example.solo

import com.intellij.openapi.project.Project
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import javax.swing.*

class CustomPanel(private val project: Project) : JPanel(BorderLayout()) {
    
    private val contentArea = JPanel()
    private val titleLabel = JBLabel("Custom Panel")
    
    init {
        setupUI()
    }
    
    private fun setupUI() {
        border = JBUI.Borders.empty(10)
        preferredSize = Dimension(300, 400)
        minimumSize = Dimension(200, 100)
        
        val headerPanel = JPanel(BorderLayout()).apply {
            border = JBUI.Borders.emptyBottom(10)
            add(titleLabel, BorderLayout.CENTER)
        }
        
        add(headerPanel, BorderLayout.NORTH)
        
        contentArea.apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            border = JBUI.Borders.emptyTop(5)
        }
        
        val scrollPane = JBScrollPane(contentArea).apply {
            border = JBUI.Borders.empty()
            horizontalScrollBarPolicy = JScrollPane.HORIZONTAL_SCROLLBAR_NEVER
        }
        
        add(scrollPane, BorderLayout.CENTER)
        
        addDefaultContent()
    }
    
    private fun addDefaultContent() {
        addContentItem("Project: ${project.name}")
        addContentItem("Mode: Solo Mode Active")
        addContentSeparator()
        addContentItem("Quick Actions")
        addActionButton("Toggle Solo Mode") {
            ToggleSoloModeAction.toggleSoloMode(project)
        }
    }
    
    fun addContentItem(text: String) {
        val label = JBLabel(text).apply {
            border = JBUI.Borders.empty(5, 0)
        }
        contentArea.add(label)
    }
    
    fun addContentSeparator() {
        val separator = JSeparator().apply {
            border = BorderFactory.createEmptyBorder(5, 0, 5, 0)
        }
        contentArea.add(separator)
    }
    
    fun addActionButton(text: String, action: () -> Unit) {
        val button = JButton(text).apply {
            border = JBUI.Borders.empty(5, 10)
            maximumSize = Dimension(Int.MAX_VALUE, preferredSize.height)
            addActionListener { action() }
        }
        contentArea.add(button)
    }
    
    fun clearContent() {
        contentArea.removeAll()
        contentArea.revalidate()
        contentArea.repaint()
    }
    
    fun refresh() {
        revalidate()
        repaint()
    }
}
