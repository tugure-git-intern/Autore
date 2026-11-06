package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandlerMenjawabTitikDanHealth(t *testing.T) {
	for _, tc := range []struct {
		path   string
		status int
		isi    string
	}{
		{"/", http.StatusOK, "Hello from Autore sandbox"},
		{"/health", http.StatusOK, `{"status":"ok"}`},
		{"/tidak-ada", http.StatusNotFound, "404 page not found"},
	} {
		rec := httptest.NewRecorder()
		handler(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if rec.Code != tc.status {
			t.Errorf("%s: status %d, mau %d", tc.path, rec.Code, tc.status)
		}
		if !strings.Contains(rec.Body.String(), tc.isi) {
			t.Errorf("%s: body %q tidak memuat %q", tc.path, rec.Body.String(), tc.isi)
		}
	}
}
