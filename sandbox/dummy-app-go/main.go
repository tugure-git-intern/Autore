package main

import (
	"fmt"
	"log"
	"net/http"
)

const alamat = ":8080"

func handler(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/health":
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"status":"ok"}`)
	case "/":
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprint(w, "Hello from Autore sandbox")
	default:
		http.NotFound(w, r)
	}
}

func main() {
	fmt.Println("Listening on 0.0.0.0" + alamat)
	log.Fatal(http.ListenAndServe(alamat, http.HandlerFunc(handler)))
}
