import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

/** Contoh aplikasi Java minimal (tanpa framework): menjawab / dan /health pada port 8080. */
public class Main {
    private static final int PORT = 8080;
    private static final String GREETING = "Hello from Autore sandbox";

    private static void kirim(HttpExchange x, int status, String tipe, String isi) throws IOException {
        byte[] data = isi.getBytes(StandardCharsets.UTF_8);
        x.getResponseHeaders().add("Content-Type", tipe);
        x.sendResponseHeaders(status, data.length);
        try (OutputStream os = x.getResponseBody()) {
            os.write(data);
        }
    }

    private static HttpHandler handler(int status, String tipe, String isi) {
        return x -> {
            try {
                kirim(x, status, tipe, isi);
            } catch (IOException e) {
                x.close();
            }
        };
    }

    public static void main(String[] args) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", PORT), 0);
        server.createContext("/health", handler(200, "application/json", "{\"status\":\"ok\"}"));
        server.createContext("/", x -> {
            try {
                if (x.getRequestURI().getPath().equals("/")) {
                    kirim(x, 200, "text/plain; charset=utf-8", GREETING);
                } else {
                    kirim(x, 404, "text/plain; charset=utf-8", "Not Found");
                }
            } catch (IOException e) {
                x.close();
            }
        });
        server.setExecutor(null);
        System.out.println("Listening on 0.0.0.0:" + PORT);
        server.start();
    }
}
