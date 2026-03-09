package com.example.solo

import com.intellij.openapi.project.Project
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import javax.swing.*

class CustomPanel(private val project: Project) : JPanel(BorderLayout()) {
    
    private val browser: JBCefBrowser
    
    init {
        browser = createBrowser()
        setupUI()
    }
    
    private fun createBrowser(): JBCefBrowser {
        val browser = JBCefBrowser("https://www.jetbrains.com")
        return browser
    }
    
    private fun setupUI() {
        border = JBUI.Borders.empty()
        preferredSize = Dimension(300, 400)
        minimumSize = Dimension(200, 100)
        
        val browserComponent = browser.component
        add(browserComponent, BorderLayout.CENTER)
    }
    
    fun loadURL(url: String) {
        browser.loadURL(url)
    }
    
    fun refresh() {
        browser.cefBrowser.reload()
    }
    
    fun goBack() {
        browser.cefBrowser.goBack()
    }
    
    fun goForward() {
        browser.cefBrowser.goForward()
    }
    
    fun dispose() {
        browser.dispose()
    }
}
