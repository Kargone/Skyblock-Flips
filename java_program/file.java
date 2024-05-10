import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.URI;
import java.io.*;

public class file {
    public static void main(String[] args) {
        HttpClient client = HttpClient.newHttpClient();
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:8000"))
            .POST(HttpRequest.BodyPublishers.ofString("Test"))
            .build();
        try {
            try {
                HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            } catch (IOException ex) {
                System.out.println(ex);
            }
        } catch (InterruptedException ex) {
            System.out.println(ex);
        }
    }
}