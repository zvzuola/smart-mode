package com.example.solo.vcoder.integration;

import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.SelectionModel;
import com.intellij.openapi.fileEditor.FileEditor;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.fileEditor.OpenFileDescriptor;
import com.intellij.openapi.fileEditor.TextEditor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VirtualFile;
import org.jetbrains.annotations.NotNull;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public class ProjectContextProvider {
    private final Project project;

    public ProjectContextProvider(@NotNull Project project) {
        this.project = project;
    }

    public boolean isHarmonyOSProject() {
        String basePath = project.getBasePath();
        if (basePath == null) return false;
        String[] harmonyFiles = {"build-profile.json5", "oh-package.json5", "hvigorfile.ts", "module.json5"};
        for (String fileName : harmonyFiles) {
            if (Path.of(basePath, fileName).toFile().exists()) {
                return true;
            }
            if (Path.of(basePath, "entry", "src", "main", "module.json5").toFile().exists()) {
                return true;
            }
        }
        return false;
    }

    public List<String> getOpenFiles() {
        List<String> files = new ArrayList<>();
        FileEditorManager editorManager = FileEditorManager.getInstance(project);
        for (VirtualFile file : editorManager.getOpenFiles()) {
            files.add(file.getPath());
        }
        return files;
    }

    public String getCurrentFilePath() {
        FileEditorManager editorManager = FileEditorManager.getInstance(project);
        VirtualFile[] selectedFiles = editorManager.getSelectedFiles();
        if (selectedFiles.length > 0) {
            return selectedFiles[0].getPath();
        }
        return null;
    }

    public SelectionInfo getCurrentSelection() {
        FileEditorManager editorManager = FileEditorManager.getInstance(project);
        FileEditor fileEditor = editorManager.getSelectedEditor();
        if (fileEditor instanceof TextEditor textEditor) {
            Editor editor = textEditor.getEditor();
            SelectionModel selectionModel = editor.getSelectionModel();
            String selectedText = selectionModel.getSelectedText();
            if (selectedText == null) selectedText = "";
            VirtualFile file = editorManager.getSelectedFiles().length > 0 ? editorManager.getSelectedFiles()[0] : null;
            String filePath = file != null ? file.getPath() : "";
            int startLine = editor.getDocument().getLineNumber(selectionModel.getSelectionStart()) + 1;
            int endLine = editor.getDocument().getLineNumber(selectionModel.getSelectionEnd()) + 1;
            return new SelectionInfo(selectedText, filePath, startLine, endLine);
        }
        return new SelectionInfo("", "", 0, 0);
    }

    public void openFileInEditor(String filePath, int line) {
        ApplicationManager.getApplication().invokeLater(() -> {
            VirtualFile file = LocalFileSystem.getInstance().findFileByPath(filePath);
            if (file != null) {
                OpenFileDescriptor descriptor = new OpenFileDescriptor(project, file, Math.max(0, line - 1), 0);
                FileEditorManager.getInstance(project).openTextEditor(descriptor, true);
            }
        });
    }

    public String getProjectBasePath() {
        return project.getBasePath();
    }

    public String getProjectName() {
        return project.getName();
    }

    public record SelectionInfo(String text, String filePath, int startLine, int endLine) {}
}
