package com.example.solo.vcoder.webview;

final class CefQueryScriptBuilder {

    static final String SUCCESS_CALLBACK =
        "function(response) { if (params && typeof params.onSuccess === 'function') { params.onSuccess(response); } }";
    static final String FAILURE_CALLBACK =
        "function(error_code, error_message) { if (params && typeof params.onFailure === 'function') { params.onFailure(error_code, error_message); } }";

    static String wrapCefQuery(String injectBody) {
        return String.format("""
            window.cefQuery = function(params) {
                try {
                    %s
                } catch (err) {
                    console.error('[VCoder] cefQuery bridge error', err);
                    if (params && typeof params.onFailure === 'function') {
                        params.onFailure(-1, (err && err.message) ? err.message : String(err));
                    }
                }
            };
            console.log('[VCoder] cefQuery bridge initialized');
            """, injectBody);
    }

    private CefQueryScriptBuilder() {
    }
}
