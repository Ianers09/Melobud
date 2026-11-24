from rest_framework.authentication import SessionAuthentication


class CsrfSessionAuthentication(SessionAuthentication):
    """Django session auth with CSRF enforcement (DRF default behaviour).

    The browser stores only an HttpOnly session cookie; the React app echoes
    the csrftoken cookie in the X-CSRFToken header on unsafe requests.
    """

    def authenticate_header(self, request):
        # Makes DRF return 401 (not 403) for unauthenticated requests so the
        # frontend can distinguish an expired session from a forbidden action.
        return "Session"
